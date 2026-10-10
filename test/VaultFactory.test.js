const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("VaultFactory", function () {
  const INTERVAL = 90 * 24 * 60 * 60; // 90 days
  const GRACE = 7 * 24 * 60 * 60; // 7 days

  async function deployFactory() {
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();
    const Factory = await ethers.getContractFactory("VaultFactory");
    const factory = await Factory.deploy();
    return { factory, usdc };
  }

  function parseCreated(factory, receipt) {
    return receipt.logs
      .map((log) => {
        try {
          return factory.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((e) => e && e.name === "VaultCreated");
  }

  it("runs its tests on a Monad chain ID", async function () {
    const network = await ethers.provider.getNetwork();
    expect(network.chainId).to.equal(10143n);
  });

  it("creates a vault clone and initializes it", async function () {
    const { factory } = await deployFactory();
    const [owner, b1, b2] = await ethers.getSigners();

    const tx = await factory
      .connect(owner)
      .createVault("Kids", [b1.address, b2.address], [6000, 4000], INTERVAL, GRACE);
    const event = parseCreated(factory, await tx.wait());

    expect(event).to.not.be.undefined;
    const vaultAddress = event.args.vault;
    expect(vaultAddress).to.not.equal(ethers.ZeroAddress);
    expect(event.args.name).to.equal("Kids");
    expect(event.args.beneficiaries).to.deep.equal([b1.address, b2.address]);

    const Vault = await ethers.getContractFactory("Vault");
    const vault = Vault.attach(vaultAddress);
    expect(await vault.owner()).to.equal(owner.address);
    expect(await vault.name()).to.equal("Kids");
    expect(await vault.shareOf(b1.address)).to.equal(6000);
    expect(await vault.shareOf(b2.address)).to.equal(4000);
    expect(await vault.checkInInterval()).to.equal(INTERVAL);
    expect(await vault.gracePeriod()).to.equal(GRACE);
    expect(await vault.state()).to.equal(0); // Active

    expect(await factory.getVaultsByOwner(owner.address)).to.deep.equal([vaultAddress]);
    expect(await factory.getVaultsByBeneficiary(b1.address)).to.deep.equal([vaultAddress]);
    expect(await factory.getVaultsByBeneficiary(b2.address)).to.deep.equal([vaultAddress]);
  });

  it("lets one owner create several independent vaults", async function () {
    const { factory } = await deployFactory();
    const [owner, b1, b2] = await ethers.getSigners();

    await factory.connect(owner).createVault("Spouse", [b1.address], [10000], INTERVAL, GRACE);
    await factory
      .connect(owner)
      .createVault("Kids", [b1.address, b2.address], [5000, 5000], INTERVAL * 2, 0);

    const mine = await factory.getVaultsByOwner(owner.address);
    expect(mine.length).to.equal(2);
    expect(mine[0]).to.not.equal(mine[1]);
    expect(await factory.getVaultsByBeneficiary(b1.address)).to.deep.equal([...mine]);
    expect(await factory.getVaultsByBeneficiary(b2.address)).to.deep.equal([mine[1]]);

    const Vault = await ethers.getContractFactory("Vault");
    expect(await Vault.attach(mine[1]).checkInInterval()).to.equal(INTERVAL * 2);
  });

  describe("rejects invalid beneficiary setups", function () {
    let factory, owner, b1, b2;
    beforeEach(async function () {
      ({ factory } = await deployFactory());
      [owner, b1, b2] = await ethers.getSigners();
    });

    const cases = [
      ["no beneficiaries", () => [[], []], "1 to 10 beneficiaries"],
      ["mismatched shares", () => [[b1.address, b2.address], [10000]], "Shares length mismatch"],
      ["zero address", () => [[ethers.ZeroAddress], [10000]], "Invalid beneficiary"],
      ["owner as beneficiary", () => [[owner.address], [10000]], "Beneficiary cannot be owner"],
      ["duplicate", () => [[b1.address, b1.address], [5000, 5000]], "Duplicate beneficiary"],
      ["zero share", () => [[b1.address, b2.address], [10000, 0]], "Share must be > 0"],
      ["shares under 100%", () => [[b1.address, b2.address], [5000, 4000]], "Shares must total 100%"],
      ["shares over 100%", () => [[b1.address, b2.address], [6000, 5000]], "Shares must total 100%"],
    ];

    for (const [label, args, reason] of cases) {
      it(label, async function () {
        const [addrs, shares] = args();
        await expect(
          factory.connect(owner).createVault("x", addrs, shares, INTERVAL, GRACE)
        ).to.be.revertedWith(reason);
      });
    }

    it("more than 10 beneficiaries", async function () {
      const addrs = Array.from({ length: 11 }, () => ethers.Wallet.createRandom().address);
      const shares = Array(11).fill(0);
      shares[0] = 10000;
      await expect(
        factory.connect(owner).createVault("x", addrs, shares, INTERVAL, GRACE)
      ).to.be.revertedWith("1 to 10 beneficiaries");
    });

    it("a name longer than 64 bytes", async function () {
      await expect(
        factory.connect(owner).createVault("x".repeat(65), [b1.address], [10000], INTERVAL, GRACE)
      ).to.be.revertedWith("Name too long");
    });
  });

  it("caps the check-in interval at 10 years and the grace period at 1 year", async function () {
    const { factory } = await deployFactory();
    const [owner, b1] = await ethers.getSigners();
    const DAY = 24 * 60 * 60;
    await expect(
      factory.connect(owner).createVault("x", [b1.address], [10000], 3650 * DAY + 1, 0)
    ).to.be.revertedWith("Interval too long");
    await expect(
      factory.connect(owner).createVault("x", [b1.address], [10000], INTERVAL, 365 * DAY + 1)
    ).to.be.revertedWith("Grace period too long");
    // A vault at both limits works, and its views don't overflow.
    await factory.connect(owner).createVault("x", [b1.address], [10000], 3650 * DAY, 365 * DAY);
  });

  it("reverts on a check-in interval under a day", async function () {
    const { factory } = await deployFactory();
    const [owner, b1] = await ethers.getSigners();
    for (const interval of [0, 1, 86400 - 1]) {
      await expect(
        factory.connect(owner).createVault("x", [b1.address], [10000], interval, GRACE)
      ).to.be.revertedWith("Interval too short");
    }
    await factory.connect(owner).createVault("x", [b1.address], [10000], 86400, 0);
  });

  it("rejects beneficiaries that could never move their share", async function () {
    const { factory } = await deployFactory();
    const [owner] = await ethers.getSigners();
    for (const stuck of [await factory.getAddress()]) {
      await expect(
        factory.connect(owner).createVault("x", [stuck], [10000], INTERVAL, GRACE)
      ).to.be.revertedWith("Invalid beneficiary");
    }
    // The vault's own address only exists once it's created.
    const [, b1] = await ethers.getSigners();
    await factory.connect(owner).createVault("x", [b1.address], [10000], INTERVAL, GRACE);
    const [address] = await factory.getVaultsByOwner(owner.address);
    const vault = (await ethers.getContractFactory("Vault")).attach(address);
    await expect(vault.connect(owner).setBeneficiaries([address], [10000])).to.be.revertedWith(
      "Invalid beneficiary"
    );
  });

  it("pages through every vault", async function () {
    const { factory } = await deployFactory();
    const [owner, b1] = await ethers.getSigners();
    for (let i = 0; i < 5; i++) {
      await factory.connect(owner).createVault(`v${i}`, [b1.address], [10000], INTERVAL, GRACE);
    }
    const all = await factory.getAllVaults();
    expect(await factory.getVaults(0, 2)).to.deep.equal(all.slice(0, 2));
    expect(await factory.getVaults(3, 10)).to.deep.equal(all.slice(3));
    expect(await factory.getVaults(5, 10)).to.deep.equal([]);
  });

  it("tracks vaultCount and getAllVaults across multiple owners", async function () {
    const { factory } = await deployFactory();
    const [ownerA, ownerB, beneficiary] = await ethers.getSigners();

    await factory.connect(ownerA).createVault("A", [beneficiary.address], [10000], INTERVAL, GRACE);
    await factory.connect(ownerB).createVault("B", [beneficiary.address], [10000], INTERVAL, GRACE);

    expect(await factory.vaultCount()).to.equal(2);
    const all = await factory.getAllVaults();
    expect(all.length).to.equal(2);
    expect(all[0]).to.equal((await factory.getVaultsByOwner(ownerA.address))[0]);
    expect(all[1]).to.equal((await factory.getVaultsByOwner(ownerB.address))[0]);
  });
});
