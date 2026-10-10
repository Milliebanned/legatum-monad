const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("./utils/time");

describe("Vault", function () {
  const INTERVAL = 90 * 24 * 60 * 60; // 90 days
  const GRACE = 7 * 24 * 60 * 60; // 7 days
  const DEADLINE = INTERVAL + GRACE;
  const DEPOSIT = ethers.parseUnits("100", 6);

  // 50% / 30% / 20%
  const SHARES = [5000, 3000, 2000];

  async function vaultFrom(factory, owner) {
    const [vaultAddress] = (await factory.getVaultsByOwner(owner.address)).slice(-1);
    const Vault = await ethers.getContractFactory("Vault");
    return Vault.attach(vaultAddress);
  }

  async function setup() {
    const [owner, b1, b2, b3, stranger] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();
    await usdc.mint(owner.address, ethers.parseUnits("1000", 6));

    const Factory = await ethers.getContractFactory("VaultFactory");
    const factory = await Factory.deploy();

    await factory
      .connect(owner)
      .createVault("Family", [b1.address, b2.address, b3.address], SHARES, INTERVAL, GRACE);
    const vault = await vaultFrom(factory, owner);

    return { owner, b1, b2, b3, stranger, usdc, factory, vault };
  }

  async function setupAndDeposit(amount = DEPOSIT) {
    const ctx = await setup();
    await ctx.usdc.connect(ctx.owner).approve(await ctx.vault.getAddress(), amount);
    await ctx.vault.connect(ctx.owner).deposit(ctx.usdc, amount);
    return ctx;
  }

  describe("initialization", function () {
    it("starts Active with name, beneficiaries and shares recorded", async function () {
      const { vault, owner, b1, b2, b3 } = await setup();
      expect(await vault.state()).to.equal(0); // Active
      expect(await vault.owner()).to.equal(owner.address);
      expect(await vault.name()).to.equal("Family");
      const latest = await time.latest();
      expect(await vault.lastCheckInTime()).to.be.closeTo(latest, 5);

      const [addrs, shares] = await vault.getBeneficiaries();
      expect(addrs).to.deep.equal([b1.address, b2.address, b3.address]);
      expect(shares.map(Number)).to.deep.equal(SHARES);
      expect(await vault.beneficiaryCount()).to.equal(3);
      expect(await vault.shareOf(b2.address)).to.equal(3000);
    });

    it("cannot be initialized twice", async function () {
      const { vault, owner, b1 } = await setup();
      await expect(
        vault.connect(owner).initialize(owner.address, "x", [b1.address], [10000], INTERVAL, GRACE)
      ).to.be.revertedWith("Already initialized");
    });

    it("locks the bare implementation contract against initialize()", async function () {
      const { usdc } = await setup();
      const Vault = await ethers.getContractFactory("Vault");
      const impl = await Vault.deploy();
      const [, , , , stranger, other] = await ethers.getSigners();
      await expect(
        impl.initialize(stranger.address, "x", [other.address], [10000], INTERVAL, GRACE)
      ).to.be.revertedWith("Already initialized");
    });
  });

  describe("deposit", function () {
    it("increases vault balance on deposit", async function () {
      const { vault, owner, usdc } = await setup();
      await usdc.connect(owner).approve(await vault.getAddress(), DEPOSIT);
      await expect(vault.connect(owner).deposit(usdc, DEPOSIT))
        .to.emit(vault, "Deposited")
        .withArgs(owner.address, usdc.target, DEPOSIT);
      expect(await vault.balanceOf(usdc)).to.equal(DEPOSIT);
    });

    it("reverts if a non-owner tries to deposit", async function () {
      const { vault, b1, usdc } = await setup();
      await expect(vault.connect(b1).deposit(usdc, DEPOSIT)).to.be.revertedWith("Only owner");
    });
  });

  describe("checkIn", function () {
    it("resets lastCheckInTime and stays Active", async function () {
      const { vault, owner } = await setup();
      await time.increase(INTERVAL / 2);
      await vault.connect(owner).checkIn();
      const latest = await time.latest();
      expect(await vault.lastCheckInTime()).to.be.closeTo(latest, 5);
      expect(await vault.state()).to.equal(0); // Active
    });

    it("reverts if a non-owner tries to check in", async function () {
      const { vault, b1 } = await setup();
      await expect(vault.connect(b1).checkIn()).to.be.revertedWith("Only owner");
    });

    it("allows check-in one second before the deadline", async function () {
      const { vault, owner } = await setup();
      await time.increase(DEADLINE - 1);
      await expect(vault.connect(owner).checkIn()).to.not.be.reverted;
      expect(await vault.state()).to.equal(0); // Active
    });

    it("pulls a lapsed vault back if it hasn't been distributed", async function () {
      const { vault, owner } = await setupAndDeposit();
      await time.increase(DEADLINE + 1);
      expect(await vault.getVaultState()).to.equal(1); // Due
      expect(await vault.isDue()).to.equal(true);

      await vault.connect(owner).checkIn();
      expect(await vault.getVaultState()).to.equal(0); // Active
      expect(await vault.isDue()).to.equal(false);
    });

    it("gives strangers no way to lock the owner out of a lapsed vault", async function () {
      const { vault, owner } = await setupAndDeposit();
      await time.increase(DEADLINE + 1);
      // Nothing but distribute() can change a lapsed vault's stored state, so
      // the owner can still take the funds back without checking in first.
      expect(vault.interface.getFunction("updateState")).to.equal(null);
      expect(await vault.state()).to.equal(0); // Active
      await expect(vault.connect(owner).cancel()).to.not.be.reverted;
    });

    it("reverts once the vault has been distributed", async function () {
      const { vault, owner, stranger } = await setupAndDeposit();
      await time.increase(DEADLINE + 1);
      await vault.connect(stranger).distribute();
      await expect(vault.connect(owner).checkIn()).to.be.revertedWith("Vault not active");
    });
  });

  describe("distribute", function () {
    it("reverts before the deadline", async function () {
      const { vault, stranger } = await setupAndDeposit();
      await time.increase(DEADLINE - 10);
      expect(await vault.isDue()).to.equal(false);
      await expect(vault.connect(stranger).distribute()).to.be.revertedWith("Not due yet");
    });

    it("sends every beneficiary their share in one call, with no claiming", async function () {
      const { vault, b1, b2, b3, stranger, usdc } = await setupAndDeposit();
      await time.increase(DEADLINE + 1);
      expect(await vault.isDue()).to.equal(true);

      // Anyone can trigger it: here a stranger, standing in for the keeper.
      await expect(vault.connect(stranger).distribute())
        .to.emit(vault, "Distributed")
        .withArgs(stranger.address)
        .and.to.emit(vault, "Paid")
        .withArgs(b1.address, usdc.target, ethers.parseUnits("50", 6));

      expect(await usdc.balanceOf(b1.address)).to.equal(ethers.parseUnits("50", 6));
      expect(await usdc.balanceOf(b2.address)).to.equal(ethers.parseUnits("30", 6));
      expect(await usdc.balanceOf(b3.address)).to.equal(ethers.parseUnits("20", 6));
      expect(await vault.balanceOf(usdc)).to.equal(0);
      expect(await vault.state()).to.equal(2); // Distributed
      expect(await vault.distributedPool(usdc)).to.equal(DEPOSIT);
      expect(await vault.isDue()).to.equal(false);
    });

    it("never marks payouts failed because the caller supplied too little gas", async function () {
      const { vault, stranger, usdc } = await setupAndDeposit();
      await time.increase(DEADLINE + 1);
      const [addrs] = await vault.getBeneficiaries();

      // Sweep gas limits across the whole range where distribute() could run
      // out partway through the payout loop. Every attempt must either revert
      // with nothing changed, or pay everyone; none may leave a share owed.
      let paidAt = null;
      for (let gas = 100_000; gas <= 500_000 && paidAt === null; gas += 5_000) {
        const snapshot = await ethers.provider.send("evm_snapshot", []);
        try {
          await (await vault.connect(stranger).distribute({ gasLimit: gas })).wait();
          for (const b of addrs) expect(await vault.owed(usdc, b)).to.equal(0);
          expect(await vault.balanceOf(usdc)).to.equal(0);
          paidAt = gas;
        } catch (err) {
          if (err.name === "AssertionError") throw err;
          expect(await vault.isDue()).to.equal(true); // reverted: untouched
        }
        await ethers.provider.send("evm_revert", [snapshot]);
      }
      expect(paidAt).to.not.equal(null);
    });

    it("can only run once", async function () {
      const { vault, stranger } = await setupAndDeposit();
      await time.increase(DEADLINE + 1);
      await vault.connect(stranger).distribute();
      await expect(vault.connect(stranger).distribute()).to.be.revertedWith("Not due yet");
    });

    it("gives rounding dust to the last beneficiary so nothing is stranded", async function () {
      // 3 base units split 50/30/20 -> 1, 0, then the remainder.
      const { vault, b1, b2, b3, stranger, usdc } = await setupAndDeposit(3n);
      await time.increase(DEADLINE + 1);
      await vault.connect(stranger).distribute();
      expect(await usdc.balanceOf(b1.address)).to.equal(1n);
      expect(await usdc.balanceOf(b2.address)).to.equal(0n);
      expect(await usdc.balanceOf(b3.address)).to.equal(2n);
      expect(await vault.balanceOf(usdc)).to.equal(0);
    });

    it("works with a single 100% beneficiary", async function () {
      const { factory, usdc, owner, b1, stranger } = await setup();
      await factory.connect(owner).createVault("Solo", [b1.address], [10000], INTERVAL, GRACE);
      const vault = await vaultFrom(factory, owner);
      await usdc.connect(owner).approve(await vault.getAddress(), DEPOSIT);
      await vault.connect(owner).deposit(usdc, DEPOSIT);
      await time.increase(DEADLINE + 1);

      await expect(vault.connect(stranger).distribute()).to.emit(vault, "Paid").withArgs(b1.address, usdc.target, DEPOSIT);
      expect(await usdc.balanceOf(b1.address)).to.equal(DEPOSIT);
    });

    it("finishes an empty vault without paying anyone", async function () {
      const { vault, stranger } = await setup(); // no deposit
      await time.increase(DEADLINE + 1);
      await expect(vault.connect(stranger).distribute()).to.not.emit(vault, "Paid");
      expect(await vault.state()).to.equal(2); // Distributed
    });

    it("shareValue shows each person's current share, then what they're owed", async function () {
      const { vault, b1, stranger, usdc } = await setupAndDeposit();
      expect(await vault.shareValue(usdc, b1.address)).to.equal(ethers.parseUnits("50", 6));
      expect(await vault.shareValue(usdc, stranger.address)).to.equal(0);
      await time.increase(DEADLINE + 1);
      await vault.connect(stranger).distribute();
      expect(await vault.shareValue(usdc, b1.address)).to.equal(0); // paid, nothing owed
    });
  });

  describe("failed transfers", function () {
    async function blacklistSetup() {
      const [owner, b1, b2, b3, stranger] = await ethers.getSigners();
      const Token = await ethers.getContractFactory("BlacklistUSDC");
      const usdc = await Token.deploy();
      await usdc.mint(owner.address, DEPOSIT);
      const Factory = await ethers.getContractFactory("VaultFactory");
      const factory = await Factory.deploy();
      await factory
        .connect(owner)
        .createVault("Family", [b1.address, b2.address, b3.address], SHARES, INTERVAL, GRACE);
      const vault = await vaultFrom(factory, owner);
      await usdc.connect(owner).approve(await vault.getAddress(), DEPOSIT);
      await vault.connect(owner).deposit(usdc, DEPOSIT);
      await time.increase(DEADLINE + 1);
      return { usdc, vault, b1, b2, b3, stranger };
    }

    it("pays everyone else and holds the blocked share", async function () {
      const { usdc, vault, b1, b2, b3, stranger } = await blacklistSetup();
      await usdc.setBlacklisted(b2.address, true);

      await expect(vault.connect(stranger).distribute())
        .to.emit(vault, "PayoutFailed")
        .withArgs(b2.address, usdc.target, ethers.parseUnits("30", 6));

      expect(await usdc.balanceOf(b1.address)).to.equal(ethers.parseUnits("50", 6));
      expect(await usdc.balanceOf(b2.address)).to.equal(0);
      expect(await usdc.balanceOf(b3.address)).to.equal(ethers.parseUnits("20", 6));
      expect(await vault.owed(usdc, b2.address)).to.equal(ethers.parseUnits("30", 6));
      expect(await vault.shareValue(usdc, b2.address)).to.equal(ethers.parseUnits("30", 6));
      expect(await vault.balanceOf(usdc)).to.equal(ethers.parseUnits("30", 6));
    });

    it("lets the blocked beneficiary withdraw once unblocked, exactly once", async function () {
      const { usdc, vault, b2, stranger } = await blacklistSetup();
      await usdc.setBlacklisted(b2.address, true);
      await vault.connect(stranger).distribute();

      await expect(vault.connect(b2).withdrawOwed(usdc)).to.be.revertedWith("Blacklisted");
      await usdc.setBlacklisted(b2.address, false);
      await expect(vault.connect(b2).withdrawOwed(usdc))
        .to.emit(vault, "OwedWithdrawn")
        .withArgs(b2.address, usdc.target, ethers.parseUnits("30", 6));
      expect(await usdc.balanceOf(b2.address)).to.equal(ethers.parseUnits("30", 6));
      expect(await vault.balanceOf(usdc)).to.equal(0);
      await expect(vault.connect(b2).withdrawOwed(usdc)).to.be.revertedWith("Nothing owed");
    });

    it("withdrawOwed is refused to anyone not owed", async function () {
      const { vault, b1, stranger, usdc } = await blacklistSetup();
      await vault.connect(stranger).distribute();
      await expect(vault.connect(b1).withdrawOwed(usdc)).to.be.revertedWith("Nothing owed");
    });
  });

  describe("withdraw", function () {
    it("lets the owner withdraw part of the balance while active", async function () {
      const { vault, owner, usdc } = await setupAndDeposit();
      const before = await usdc.balanceOf(owner.address);
      const partial = ethers.parseUnits("40", 6);
      await expect(vault.connect(owner).withdraw(usdc, partial))
        .to.emit(vault, "Withdrawn")
        .withArgs(owner.address, usdc.target, partial);
      expect((await usdc.balanceOf(owner.address)) - before).to.equal(partial);
      expect(await vault.balanceOf(usdc)).to.equal(DEPOSIT - partial);
    });

    it("reverts if a non-owner tries to withdraw", async function () {
      const { vault, b1, usdc } = await setupAndDeposit();
      await expect(vault.connect(b1).withdraw(usdc, ethers.parseUnits("1", 6))).to.be.revertedWith(
        "Only owner"
      );
    });

    it("reverts once the vault is cancelled", async function () {
      const { vault, owner, usdc } = await setupAndDeposit();
      await vault.connect(owner).cancel();
      await expect(vault.connect(owner).withdraw(usdc, ethers.parseUnits("1", 6))).to.be.revertedWith(
        "Vault not active"
      );
    });

    it("reverts once the vault has been distributed", async function () {
      const { vault, owner, stranger, usdc } = await setupAndDeposit();
      await time.increase(DEADLINE + 1);
      await vault.connect(stranger).distribute();
      await expect(vault.connect(owner).withdraw(usdc, 1n)).to.be.revertedWith("Vault not active");
    });
  });

  describe("cancel", function () {
    it("returns full balance to owner and sets state to Cancelled", async function () {
      const { vault, owner, usdc } = await setupAndDeposit();
      const before = await usdc.balanceOf(owner.address);
      await expect(vault.connect(owner).cancel()).to.emit(vault, "Cancelled").withArgs(owner.address);
      expect((await usdc.balanceOf(owner.address)) - before).to.equal(DEPOSIT);
      expect(await vault.state()).to.equal(3); // Cancelled
      expect(await vault.balanceOf(usdc)).to.equal(0);
    });

    it("reverts if a non-owner tries to cancel", async function () {
      const { vault, b1 } = await setupAndDeposit();
      await expect(vault.connect(b1).cancel()).to.be.revertedWith("Only owner");
    });
  });

  describe("view helpers", function () {
    it("timeUntilDeadline counts down and floors at 0", async function () {
      const { vault } = await setup();
      const remaining = await vault.timeUntilDeadline();
      expect(remaining).to.be.closeTo(BigInt(DEADLINE), 5n);

      await time.increase(DEADLINE + 100);
      expect(await vault.timeUntilDeadline()).to.equal(0);
    });

    it("getVaultState reflects Due without a transaction", async function () {
      const { vault } = await setupAndDeposit();
      expect(await vault.getVaultState()).to.equal(0); // Active
      await time.increase(DEADLINE + 1);
      expect(await vault.getVaultState()).to.equal(1); // Due, computed live
      expect(await vault.state()).to.equal(0); // storage not yet updated
    });
  });

  describe("setBeneficiaries", function () {
    it("replaces the list and shares, and the factory indexes new people", async function () {
      const { vault, factory, owner, b1, b2, b3, stranger } = await setup();
      await expect(
        vault.connect(owner).setBeneficiaries([b1.address, stranger.address], [7000, 3000])
      ).to.emit(vault, "BeneficiariesUpdated");

      const [addrs, shares] = await vault.getBeneficiaries();
      expect(addrs).to.deep.equal([b1.address, stranger.address]);
      expect(shares.map(Number)).to.deep.equal([7000, 3000]);
      expect(await vault.shareOf(b2.address)).to.equal(0);
      expect(await vault.shareOf(b3.address)).to.equal(0);

      const vaultAddress = await vault.getAddress();
      expect(await factory.getVaultsByBeneficiary(stranger.address)).to.deep.equal([vaultAddress]);
      // b1 was already indexed: not listed twice.
      expect(await factory.getVaultsByBeneficiary(b1.address)).to.deep.equal([vaultAddress]);
    });

    it("removed beneficiaries get nothing; new ones get the new split", async function () {
      const { vault, owner, usdc, b1, b2, stranger } = await setupAndDeposit();
      await vault.connect(owner).setBeneficiaries([stranger.address, b1.address], [2500, 7500]);
      await time.increase(DEADLINE + 1);

      await vault.connect(b2).distribute();
      expect(await usdc.balanceOf(b2.address)).to.equal(0);
      expect(await usdc.balanceOf(stranger.address)).to.equal(ethers.parseUnits("25", 6));
      expect(await usdc.balanceOf(b1.address)).to.equal(ethers.parseUnits("75", 6));
      expect(await vault.state()).to.equal(2); // Distributed
    });

    it("applies the same validation as creation", async function () {
      const { vault, owner, b1, b2 } = await setup();
      await expect(
        vault.connect(owner).setBeneficiaries([b1.address, b2.address], [5000, 4000])
      ).to.be.revertedWith("Shares must total 100%");
      await expect(vault.connect(owner).setBeneficiaries([owner.address], [10000])).to.be.revertedWith(
        "Beneficiary cannot be owner"
      );
      await expect(vault.connect(owner).setBeneficiaries([], [])).to.be.revertedWith("1 to 10 beneficiaries");
    });

    it("is owner-only", async function () {
      const { vault, b1 } = await setup();
      await expect(vault.connect(b1).setBeneficiaries([b1.address], [10000])).to.be.revertedWith("Only owner");
    });

    it("is blocked once the vault has been distributed", async function () {
      const { vault, owner, stranger } = await setupAndDeposit();
      await time.increase(DEADLINE + 1);
      await vault.connect(stranger).distribute();
      await expect(vault.connect(owner).setBeneficiaries([stranger.address], [10000])).to.be.revertedWith(
        "Vault not active"
      );
    });

    it("only vaults can register beneficiaries with the factory", async function () {
      const { factory, stranger } = await setup();
      await expect(factory.connect(stranger).registerBeneficiaries([stranger.address])).to.be.revertedWith(
        "Only vaults"
      );
    });
  });

  describe("history", function () {
    const A = { Created: 0, BeneficiariesSet: 1, Deposit: 2, Withdraw: 3, CheckIn: 4, Payout: 5, PayoutFailed: 6, Cancel: 7 };

    async function allHistory(vault) {
      const n = await vault.historyLength();
      return (await vault.getHistory(0, n)).map((e) => ({
        action: Number(e.action),
        actor: e.actor,
        token: e.token,
        amount: e.amount,
        timestamp: Number(e.timestamp),
      }));
    }

    it("records creation, deposits, withdrawals, check-ins, edits and payouts in order", async function () {
      const { vault, owner, b1, b2, stranger, usdc } = await setupAndDeposit();
      await vault.connect(owner).withdraw(usdc, ethers.parseUnits("10", 6));
      await vault.connect(owner).checkIn();
      await vault.connect(owner).setBeneficiaries([b1.address, b2.address], [5000, 5000]);
      await time.increase(DEADLINE + 1);
      await vault.connect(stranger).distribute();

      const h = await allHistory(vault);
      expect(h.map((e) => e.action)).to.deep.equal([
        A.Created,
        A.BeneficiariesSet,
        A.Deposit,
        A.Withdraw,
        A.CheckIn,
        A.BeneficiariesSet,
        A.Payout,
        A.Payout,
      ]);
      expect(h[1].amount).to.equal(3n); // three beneficiaries at creation
      expect(h[2].amount).to.equal(DEPOSIT);
      expect(h[3].amount).to.equal(ethers.parseUnits("10", 6));
      expect(h[5].amount).to.equal(2n);
      expect(h[6].actor).to.equal(b1.address);
      expect(h[6].amount).to.equal(ethers.parseUnits("45", 6));
      expect(h[7].actor).to.equal(b2.address);
      expect(h[7].amount).to.equal(ethers.parseUnits("45", 6));
      expect(h[0].timestamp).to.be.closeTo(await time.latest(), DEADLINE + 60);
    });

    it("records cancellation with the returned amount", async function () {
      const { vault, owner, usdc } = await setupAndDeposit();
      await vault.connect(owner).cancel();
      const h = await allHistory(vault);
      expect(h.at(-1).action).to.equal(A.Cancel);
      expect(h.at(-1).amount).to.equal(DEPOSIT);
    });

    it("getHistory pages and clamps", async function () {
      const { vault } = await setupAndDeposit(); // 3 entries
      expect((await vault.getHistory(1, 10)).length).to.equal(2);
      expect((await vault.getHistory(3, 10)).length).to.equal(0);
      expect((await vault.getHistory(0, 1))[0].action).to.equal(A.Created);
    });
  });

  describe("reentrancy", function () {
    it("blocks a reentrant distribute() attempted from inside the token transfer", async function () {
      const [owner, beneficiary] = await ethers.getSigners();

      const ReentrantUSDC = await ethers.getContractFactory("ReentrantUSDC");
      const usdc = await ReentrantUSDC.deploy();
      await usdc.mint(owner.address, DEPOSIT);

      const Factory = await ethers.getContractFactory("VaultFactory");
      const factory = await Factory.deploy();
      await factory.connect(owner).createVault("R", [beneficiary.address], [10000], INTERVAL, GRACE);
      const vault = await vaultFrom(factory, owner);
      const vaultAddress = await vault.getAddress();

      await usdc.connect(owner).approve(vaultAddress, DEPOSIT);
      await vault.connect(owner).deposit(usdc, DEPOSIT);
      await time.increase(DEADLINE + 1);

      // Arm the token so its transfer() tries to re-enter distribute() once.
      await usdc.connect(beneficiary).arm(vaultAddress);

      await expect(vault.connect(beneficiary).distribute())
        .to.emit(vault, "Paid")
        .withArgs(beneficiary.address, usdc.target, DEPOSIT);

      // Exactly one payout reached the beneficiary — no double payout.
      expect(await usdc.balanceOf(beneficiary.address)).to.equal(DEPOSIT);
      expect(await vault.state()).to.equal(2); // Distributed
    });
  });
});
