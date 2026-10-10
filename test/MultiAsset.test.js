const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("./utils/time");

describe("Vault with several assets", function () {
  const INTERVAL = 90 * 24 * 60 * 60;
  const GRACE = 7 * 24 * 60 * 60;
  const DEADLINE = INTERVAL + GRACE;
  const NATIVE = ethers.ZeroAddress;
  const MON = ethers.parseEther("10");
  const USD = ethers.parseUnits("100", 6);
  const SHARES = [6000, 4000];

  async function vaultFrom(factory, owner) {
    const [vaultAddress] = (await factory.getVaultsByOwner(owner.address)).slice(-1);
    return (await ethers.getContractFactory("Vault")).attach(vaultAddress);
  }

  async function newToken(owner) {
    const token = await (await ethers.getContractFactory("MockUSDC")).deploy();
    await token.mint(owner.address, ethers.parseUnits("1000", 6));
    return token;
  }

  async function setup(beneficiaries) {
    const [owner, b1, b2, stranger] = await ethers.getSigners();
    const usdc = await newToken(owner);
    const ausd = await newToken(owner);
    const factory = await (await ethers.getContractFactory("VaultFactory")).deploy();
    await factory
      .connect(owner)
      .createVault("Family", beneficiaries ?? [b1.address, b2.address], SHARES, INTERVAL, GRACE);
    const vault = await vaultFrom(factory, owner);
    return { owner, b1, b2, stranger, usdc, ausd, factory, vault };
  }

  async function fund(ctx) {
    const { vault, owner, usdc, ausd } = ctx;
    await vault.connect(owner).deposit(NATIVE, MON, { value: MON });
    for (const token of [usdc, ausd]) {
      await token.connect(owner).approve(vault, USD);
      await vault.connect(owner).deposit(token, USD);
    }
    return ctx;
  }

  describe("deposits", function () {
    it("takes MON and tokens, and lists each with its balance", async function () {
      const { vault, usdc, ausd } = await fund(await setup());
      expect(await vault.getTokens()).to.deep.equal([usdc.target, ausd.target]);
      const [tokens, balances] = await vault.getBalances();
      expect(tokens).to.deep.equal([NATIVE, usdc.target, ausd.target]);
      expect(balances).to.deep.equal([MON, USD, USD]);
      expect(await vault.balanceOf(NATIVE)).to.equal(MON);
    });

    it("lists a token once however often it is deposited", async function () {
      const { vault, owner, usdc } = await setup();
      await usdc.connect(owner).approve(vault, USD);
      await vault.connect(owner).deposit(usdc, USD / 2n);
      await vault.connect(owner).deposit(usdc, USD / 2n);
      expect(await vault.getTokens()).to.deep.equal([usdc.target]);
    });

    it("rejects a MON amount that doesn't match what was sent", async function () {
      const { vault, owner, usdc } = await setup();
      await expect(vault.connect(owner).deposit(NATIVE, MON, { value: MON - 1n })).to.be.revertedWith(
        "Value mismatch"
      );
      await usdc.connect(owner).approve(vault, USD);
      await expect(vault.connect(owner).deposit(usdc, USD, { value: 1n })).to.be.revertedWith(
        "MON sent with token"
      );
    });

    it("rejects an address that isn't a token", async function () {
      const { vault, owner, stranger } = await setup();
      await expect(vault.connect(owner).deposit(stranger.address, 1n)).to.be.revertedWith("Not a token");
    });

    it("holds at most 8 tokens", async function () {
      const { vault, owner } = await setup();
      for (let i = 0; i < 8; i++) {
        const token = await newToken(owner);
        await token.connect(owner).approve(vault, 1n);
        await vault.connect(owner).deposit(token, 1n);
      }
      const ninth = await newToken(owner);
      await ninth.connect(owner).approve(vault, 1n);
      await expect(vault.connect(owner).deposit(ninth, 1n)).to.be.revertedWith("Too many tokens");
    });

    it("funds a new vault with MON in the transaction that creates it", async function () {
      const { factory, owner, b1 } = await setup();
      await factory.connect(owner).createVault("Funded", [b1.address], [10000], INTERVAL, GRACE, { value: MON });
      const vault = await vaultFrom(factory, owner);
      expect(await vault.balanceOf(NATIVE)).to.equal(MON);
      const last = (await vault.getHistory(0, 10)).at(-1);
      expect(Number(last.action)).to.equal(2); // Deposit
      expect(last.amount).to.equal(MON);
      expect(last.actor).to.equal(owner.address);
    });

    it("counts MON the owner sends straight to the vault as a deposit, and anyone else's as a gift", async function () {
      const { vault, owner, stranger } = await setup();
      await expect(owner.sendTransaction({ to: vault, value: MON }))
        .to.emit(vault, "Deposited")
        .withArgs(owner.address, NATIVE, MON);
      const before = await vault.historyLength();
      await expect(stranger.sendTransaction({ to: vault, value: 1n }))
        .to.emit(vault, "Received")
        .withArgs(stranger.address, 1n);
      expect(await vault.historyLength()).to.equal(before);
      expect(await vault.balanceOf(NATIVE)).to.equal(MON + 1n);
    });
  });

  describe("withdraw and cancel", function () {
    it("lets the owner withdraw MON", async function () {
      const { vault, owner } = await fund(await setup());
      await expect(vault.connect(owner).withdraw(NATIVE, MON / 2n)).to.changeEtherBalances(
        [vault, owner],
        [-(MON / 2n), MON / 2n]
      );
      await expect(vault.connect(owner).withdraw(NATIVE, MON)).to.be.revertedWith("Insufficient balance");
    });

    it("closes itself when the last of everything is withdrawn, and not before", async function () {
      const { vault, owner, usdc, ausd } = await fund(await setup());
      await vault.connect(owner).withdraw(usdc, USD);
      await vault.connect(owner).withdraw(NATIVE, MON);
      // One asset still holds something: open, and usable as before.
      expect(await vault.state()).to.equal(0); // Active
      await vault.connect(owner).withdraw(ausd, USD - 1n);
      expect(await vault.state()).to.equal(0);
      await vault.connect(owner).checkIn();

      await expect(vault.connect(owner).withdraw(ausd, 1n)).to.emit(vault, "Cancelled").withArgs(owner.address);
      expect(await vault.state()).to.equal(3); // Cancelled
      const last = (await vault.getHistory(0, 100)).at(-1);
      expect(Number(last.action)).to.equal(7); // Cancel
      expect(last.amount).to.equal(0);
      await expect(vault.connect(owner).checkIn()).to.be.revertedWith("Vault not active");
      await expect(vault.connect(owner).deposit(NATIVE, 1n, { value: 1n })).to.be.revertedWith("Vault not active");
    });

    it("stays open after a full withdrawal if someone else's MON is still in it", async function () {
      const { vault, owner, stranger } = await setup();
      await vault.connect(owner).deposit(NATIVE, MON, { value: MON });
      await stranger.sendTransaction({ to: vault, value: 5n });
      await vault.connect(owner).withdraw(NATIVE, MON);
      expect(await vault.state()).to.equal(0); // Active: 5 wei remain
      await vault.connect(owner).withdraw(NATIVE, 5n);
      expect(await vault.state()).to.equal(3); // Cancelled
    });

    it("leaves a vault that was never funded open", async function () {
      const { vault, owner } = await setup();
      await vault.connect(owner).checkIn();
      expect(await vault.state()).to.equal(0); // Active
    });

    it("returns every asset when the vault is closed", async function () {
      const { vault, owner, usdc, ausd } = await fund(await setup());
      const before = await usdc.balanceOf(owner.address);
      await expect(vault.connect(owner).cancel()).to.changeEtherBalances([vault, owner], [-MON, MON]);
      expect((await usdc.balanceOf(owner.address)) - before).to.equal(USD);
      expect(await ausd.balanceOf(vault)).to.equal(0);
      expect(await vault.state()).to.equal(3); // Cancelled
    });

    it("closes even when one token can't be sent back, and holds it for the owner", async function () {
      const [owner, b1] = await ethers.getSigners();
      const blocked = await (await ethers.getContractFactory("BlacklistUSDC")).deploy();
      await blocked.mint(owner.address, USD);
      const factory = await (await ethers.getContractFactory("VaultFactory")).deploy();
      await factory.connect(owner).createVault("x", [b1.address], [10000], INTERVAL, GRACE, { value: MON });
      const vault = await vaultFrom(factory, owner);
      await blocked.connect(owner).approve(vault, USD);
      await vault.connect(owner).deposit(blocked, USD);

      await blocked.setBlacklisted(owner.address, true);
      await expect(vault.connect(owner).cancel()).to.changeEtherBalances([owner], [MON]);
      expect(await vault.owed(blocked, owner.address)).to.equal(USD);

      await blocked.setBlacklisted(owner.address, false);
      await vault.connect(owner).withdrawOwed(blocked);
      expect(await blocked.balanceOf(owner.address)).to.equal(USD);
    });
  });

  describe("distribute", function () {
    it("pays every asset to every beneficiary by share in one call", async function () {
      const { vault, b1, b2, stranger, usdc, ausd } = await fund(await setup());
      await time.increase(DEADLINE + 1);

      await expect(vault.connect(stranger).distribute()).to.changeEtherBalances(
        [vault, b1, b2],
        [-MON, (MON * 6n) / 10n, (MON * 4n) / 10n]
      );
      for (const token of [usdc, ausd]) {
        expect(await token.balanceOf(b1.address)).to.equal((USD * 6n) / 10n);
        expect(await token.balanceOf(b2.address)).to.equal((USD * 4n) / 10n);
        expect(await token.balanceOf(vault)).to.equal(0);
        expect(await vault.distributedPool(token)).to.equal(USD);
      }
      expect(await vault.distributedPool(NATIVE)).to.equal(MON);
      expect(await vault.state()).to.equal(2); // Distributed
    });

    it("records which asset each payout was in", async function () {
      const { vault, stranger, usdc, ausd } = await fund(await setup());
      await time.increase(DEADLINE + 1);
      await vault.connect(stranger).distribute();
      const payouts = (await vault.getHistory(0, 100)).filter((e) => Number(e.action) === 5);
      expect(payouts.map((e) => e.token)).to.deep.equal([
        NATIVE,
        NATIVE,
        usdc.target,
        usdc.target,
        ausd.target,
        ausd.target,
      ]);
    });

    it("ignores tokens a stranger sent in until someone asks for them to be split", async function () {
      const ctx = await fund(await setup());
      const { vault, b1, b2, stranger } = ctx;
      const junk = await newToken(stranger);
      await junk.connect(stranger).transfer(vault, USD);
      expect(await vault.getTokens()).to.not.include(junk.target);

      await time.increase(DEADLINE + 1);
      await expect(vault.connect(stranger).distributeToken(junk)).to.be.revertedWith("Not distributed");
      await vault.connect(stranger).distribute();
      expect(await junk.balanceOf(vault)).to.equal(USD);

      const before = await vault.historyLength();
      await vault.connect(stranger).distributeToken(junk);
      expect(await junk.balanceOf(b1.address)).to.equal((USD * 6n) / 10n);
      expect(await junk.balanceOf(b2.address)).to.equal((USD * 4n) / 10n);
      // A token the owner never deposited leaves no trace in the history.
      expect(await vault.historyLength()).to.equal(before);
    });

    it("splits MON that arrives after the payout", async function () {
      const { vault, b1, b2, stranger } = await fund(await setup());
      await time.increase(DEADLINE + 1);
      await vault.connect(stranger).distribute();
      await stranger.sendTransaction({ to: vault, value: MON });
      await expect(vault.connect(stranger).distributeToken(NATIVE)).to.changeEtherBalances(
        [b1, b2],
        [(MON * 6n) / 10n, (MON * 4n) / 10n]
      );
      expect(await vault.distributedPool(NATIVE)).to.equal(MON * 2n);
    });

    it("still pays the rest when a token's balance can no longer be read", async function () {
      const ctx = await setup();
      const { vault, owner, b1, stranger, usdc } = ctx;
      await fund(ctx);
      // Wipe the second token's code, as if it had self-destructed.
      await ethers.provider.send("hardhat_setCode", [ctx.ausd.target, "0x"]);
      await time.increase(DEADLINE + 1);
      await vault.connect(stranger).distribute();
      expect(await usdc.balanceOf(b1.address)).to.equal((USD * 6n) / 10n);
      await expect(vault.connect(owner).checkIn()).to.be.revertedWith("Vault not active");
    });
  });

  describe("beneficiaries that can't take MON", function () {
    async function stubbornSetup(mode) {
      const [, b1] = await ethers.getSigners();
      const receiver = await (await ethers.getContractFactory("StubbornReceiver")).deploy();
      await receiver.setMode(mode);
      const ctx = await fund(await setup([b1.address, receiver.target]));
      await time.increase(DEADLINE + 1);
      return { ...ctx, receiver };
    }

    it("pays everyone else and holds the refused share", async function () {
      const { vault, b1, stranger, receiver, usdc } = await stubbornSetup(1); // Refuse
      await expect(vault.connect(stranger).distribute())
        .to.emit(vault, "PayoutFailed")
        .withArgs(receiver.target, NATIVE, (MON * 4n) / 10n);
      expect(await vault.owed(NATIVE, receiver.target)).to.equal((MON * 4n) / 10n);
      expect(await vault.owedTotal(NATIVE)).to.equal((MON * 4n) / 10n);
      expect(await vault.shareValue(NATIVE, receiver.target)).to.equal((MON * 4n) / 10n);
      // Its tokens arrived all the same.
      expect(await usdc.balanceOf(receiver.target)).to.equal((USD * 4n) / 10n);
      expect(await usdc.balanceOf(b1.address)).to.equal((USD * 6n) / 10n);
    });

    it("can't use up the gas the others' payouts need", async function () {
      const { vault, b1, stranger, receiver } = await stubbornSetup(2); // BurnGas
      const tx = await vault.connect(stranger).distribute();
      const receipt = await tx.wait();
      expect(receipt.gasUsed).to.be.lessThan(1_000_000n);
      expect(await vault.owed(NATIVE, receiver.target)).to.equal((MON * 4n) / 10n);
      expect(await ethers.provider.getBalance(vault)).to.equal((MON * 4n) / 10n);
      expect(await vault.state()).to.equal(2); // Distributed
      expect(await vault.shareOf(b1.address)).to.equal(6000);
    });

    it("keeps a held share out of later splits, and hands it over when asked", async function () {
      const { vault, b1, stranger, receiver } = await stubbornSetup(1);
      await vault.connect(stranger).distribute();
      const held = (MON * 4n) / 10n;

      // Nothing new has arrived, so there is nothing more to split.
      await expect(vault.connect(stranger).distributeToken(NATIVE)).to.changeEtherBalances([b1], [0]);
      expect(await ethers.provider.getBalance(vault)).to.equal(held);

      await expect(receiver.collect(vault, NATIVE)).to.be.revertedWith("Transfer failed");
      await receiver.setMode(0); // Accept
      await expect(receiver.collect(vault, NATIVE)).to.changeEtherBalances([vault, receiver], [-held, held]);
      expect(await vault.owedTotal(NATIVE)).to.equal(0);
      await expect(receiver.collect(vault, NATIVE)).to.be.revertedWith("Nothing owed");
    });

    it("never marks a MON payout failed because the caller supplied too little gas", async function () {
      const { vault, stranger, receiver } = await stubbornSetup(0); // Accept
      let paidAt = null;
      for (let gas = 100_000; gas <= 900_000 && paidAt === null; gas += 5_000) {
        const snapshot = await ethers.provider.send("evm_snapshot", []);
        try {
          await (await vault.connect(stranger).distribute({ gasLimit: gas })).wait();
          expect(await vault.owedTotal(NATIVE)).to.equal(0);
          expect(await vault.owed(NATIVE, receiver.target)).to.equal(0);
          paidAt = gas;
        } catch (err) {
          if (err.name === "AssertionError") throw err;
          expect(await vault.isDue()).to.equal(true); // reverted: untouched
        }
        await ethers.provider.send("evm_revert", [snapshot]);
      }
      expect(paidAt).to.not.equal(null);
    });
  });

  describe("factory", function () {
    it("lists the vaults that are due", async function () {
      const { factory, owner, b1 } = await setup(); // vault 0: 90 days + 7
      await factory.connect(owner).createVault("Short", [b1.address], [10000], 86400, 0);
      await factory.connect(owner).createVault("Closed", [b1.address], [10000], 86400, 0);
      const all = await factory.getAllVaults();
      const Vault = await ethers.getContractFactory("Vault");
      await Vault.attach(all[2]).connect(owner).cancel();

      expect(await factory.getDueVaults(0, 10)).to.deep.equal([]);
      await time.increase(86400 + 1);
      expect(await factory.getDueVaults(0, 10)).to.deep.equal([all[1]]);
      expect(await factory.getDueVaults(2, 10)).to.deep.equal([]);
      await time.increase(DEADLINE);
      expect(await factory.getDueVaults(0, 10)).to.deep.equal([all[0], all[1]]);
      expect(await factory.getDueVaults(1, 1)).to.deep.equal([all[1]]);
      expect(await factory.getDueVaults(3, 10)).to.deep.equal([]);
    });
  });

  describe("KeeperReceiver", function () {
    async function receiverSetup() {
      const ctx = await fund(await setup());
      const { factory, owner, b1 } = ctx;
      await factory.connect(owner).createVault("Second", [b1.address], [10000], INTERVAL, GRACE, { value: MON });
      const receiver = await (await ethers.getContractFactory("KeeperReceiver")).deploy();
      return { ...ctx, receiver, vaults: [...(await factory.getAllVaults())] };
    }

    it("pays a batch of due vaults delivered as a report", async function () {
      const { receiver, vaults, stranger, b1 } = await receiverSetup();
      await time.increase(DEADLINE + 1);
      const report = ethers.AbiCoder.defaultAbiCoder().encode(["address[]"], [vaults]);
      await expect(receiver.connect(stranger).onReport("0x", report))
        .to.emit(receiver, "Distributed")
        .withArgs(vaults[0])
        .and.to.emit(receiver, "Distributed")
        .withArgs(vaults[1]);
      const Vault = await ethers.getContractFactory("Vault");
      for (const v of vaults) expect(await Vault.attach(v).state()).to.equal(2);
      expect(await ethers.provider.getBalance(vaults[1])).to.equal(0);
      expect(await Vault.attach(vaults[1]).shareOf(b1.address)).to.equal(10000);
    });

    it("skips vaults that aren't due and addresses that aren't vaults", async function () {
      const { receiver, vaults, owner, stranger } = await receiverSetup();
      await time.increase(DEADLINE + 1);
      const Vault = await ethers.getContractFactory("Vault");
      await Vault.attach(vaults[0]).connect(owner).checkIn(); // no longer due

      await expect(receiver.distributeMany([vaults[0], stranger.address, receiver.target, vaults[1]]))
        .to.emit(receiver, "Skipped")
        .withArgs(vaults[0])
        .and.to.emit(receiver, "Skipped")
        .withArgs(stranger.address)
        .and.to.emit(receiver, "Distributed")
        .withArgs(vaults[1]);
      expect(await Vault.attach(vaults[0]).state()).to.equal(0); // still Active
      expect(await Vault.attach(vaults[1]).state()).to.equal(2);
    });

    it("tells a forwarder it accepts reports", async function () {
      const { receiver } = await receiverSetup();
      const selector = ethers.id("onReport(bytes,bytes)").slice(0, 10);
      expect(await receiver.supportsInterface(selector)).to.equal(true);
      expect(await receiver.supportsInterface("0x01ffc9a7")).to.equal(true); // ERC-165
      expect(await receiver.supportsInterface("0xffffffff")).to.equal(false);
    });
  });
});
