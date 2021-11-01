import { ethers } from "hardhat";
import { expect } from "chai";
import { addressOf, Signer } from "../../utils/ContractBase";
import { blockTimestamp, expectRevert, increaseTime, setEvmTime } from "../../utils/Utils";
import { ERC20OwnerMintable } from "../../utils/ERC20OwnerMintable";
import { ERC20Vesting, VestingTerms } from "../../utils/ERC20Vesting";

describe("ERC20 Vesting", async () => {
  let owner:Signer, user:Signer, user2:Signer;
  let token:ERC20OwnerMintable;
  let vesting:ERC20Vesting;
  const DAY = 60*60*24;

  beforeEach(async () => {
    [owner, user, user2] = await ethers.getSigners();
    token = await ERC20OwnerMintable.create("ERC20OwnerMintableToken", "Owner Mintable Test Token", "OTEST");
    await token.mint(owner, owner, 300);
    vesting = await ERC20Vesting.create(token, owner);
  });

  describe("Deploy", async () => {
    it("Should set the right wallet and token address", async () => {
      expect(await vesting.wallet()).to.equal(addressOf(owner));
      expect(await vesting.token()).to.equal(token.address);
    });
  });

  describe("Invalid inputs", async () => {
    it("startVesting reverts on input", async () => {
      const startTime = await blockTimestamp();
      const period = DAY * 30;
      (await expectRevert(vesting.startVesting(
        owner,
        "0x0000000000000000000000000000000000000000",
        {startTime: 0, period: period, amount: 30, claimed: 0}
      ))).to.equal("Receiver cannot be 0.");

      (await expectRevert(vesting.startVesting(
        owner,
        user,
        {startTime: 0, period: period, amount: 30, claimed: 0}
      ))).to.equal("Start time must be set.");

      (await expectRevert(vesting.startVesting(
        owner,
        user,
        {startTime: startTime, period: 0, amount: 30, claimed: 0}
      ))).to.equal("Period must be set.");

      (await expectRevert(vesting.startVesting(
        owner,
        user,
        {startTime: startTime, period: period, amount: 0, claimed: 0}
      ))).to.equal("Amount must be > 0.");

      (await expectRevert(vesting.startVesting(
        owner,
        user,
        {startTime: startTime, period: period, amount: 30, claimed: 1}
      ))).to.equal("Can not start vesting with already claimed tokens.");

      await vesting.startVesting(
        owner,
        user,
        {startTime: startTime, period: period, amount: 30, claimed: 0}
      );

      (await expectRevert(vesting.startVesting(
        owner,
        user,
        {startTime: startTime, period: period, amount: 30, claimed: 0}
      ))).to.equal("Vesting already started for account.");
    });

    it("startVestingBatch only callable by wallet", async () => {
      (await expectRevert(vesting.startVestingBatch(user,[],[]))).to.equal("Only wallet is allowed to proceed");
    });

    it("startVestingBatch zero receivers", async () => {
      (await expectRevert(vesting.startVestingBatch(owner,[],[]))).to.equal("Zero receivers.");
    });

    it("startVestingBatch receivers and terms different length", async () => {
      (await expectRevert(vesting.startVestingBatch(
        owner,
        [user],
        [{startTime: 1, period: 1, amount: 30, claimed: 0}, {startTime: 1, period: 1, amount: 30, claimed: 0}]
      ))).to.equal("Terms and receivers must have same length.");

      (await expectRevert(vesting.startVestingBatch(
        owner,
        [user, user2],
        [{startTime: 1, period: 1, amount: 30, claimed: 0}]
      ))).to.equal("Terms and receivers must have same length.");
    });

    it("stopVesting only callable by wallet", async () => {
      (await expectRevert(vesting.stopVesting(user,user))).to.equal("Only wallet is allowed to proceed");
    });

    it("stopVesting invalid inputs", async () => {
      (await expectRevert(vesting.stopVesting(owner,"0x0000000000000000000000000000000000000000"))).to.equal("Receiver cannot be 0.");
      (await expectRevert(vesting.stopVesting(owner,"0x1234000000000000000000000000000000000000"))).to.equal("No vesting data for receiver.");
    });

    it("transferVesting invalid inputs", async () => {
      (await expectRevert(vesting.transferVesting(owner,user,"0x0000000000000000000000000000000000000000"))).to.equal("Receiver cannot be 0.");
      (await expectRevert(vesting.transferVesting(user,user,"0x0000000000000000000000000000000000000000"))).to.equal("Only wallet is allowed to proceed");
    });

    it("claim reverts on input", async () => {
      (await expectRevert(vesting.claim(user, 0))).to.equal("Claiming 0 tokens.");
      (await expectRevert(vesting.claim(user, 10))).to.equal("No vesting data for sender.");

      await vesting.startVesting(
        owner,
        user,
        {startTime: await blockTimestamp(), period: DAY * 30, amount: 30, claimed: 0}
      );

      (await expectRevert(vesting.claim(user, 100))).to.equal("Claiming amount exceeds allowed tokens.");
    });
  });

  describe("Check vesting", async () => {
    it("Expected state after startVesting", async () => {
      const startTime = await blockTimestamp();
      const period = DAY * 30;
      expect(await vesting.startVesting(
        owner,
        user,
        {startTime: startTime, period: period, amount: 30, claimed: 0}
      )).to.emit(vesting.contract, "VestingAdded").withArgs(
        addressOf(user), 
        [startTime, period, vesting.toBigNum(30), 0]
      );

      const terms:VestingTerms = await vesting.getVestingTerms(user);
      expect(terms.amount).to.equal(30);
      expect(terms.startTime).to.equal(startTime);
      expect(terms.period).to.equal(period);
      expect(terms.claimed).to.equal(0);

      expect(await token.balanceOf(owner)).to.equal(270);
    });

    it("Expected claimable tokens is 0 after startVesting with startTime in future", async () => {
      await vesting.startVesting(
        owner,
        user,
        {startTime: await blockTimestamp() + 60*60*24, period: DAY * 30, amount: 30, claimed: 0}
      );

      expect(await vesting.claimable(user)).to.equal(0);
    });

    it("Expected state after startVestingBatch", async () => {
      const startTime = await blockTimestamp();
      const period = DAY * 30;
      await vesting.startVestingBatch(
        owner,
        [user, user2],
        [
          {startTime: startTime + 1, period: period - 1, amount: 60, claimed: 0},
          {startTime: startTime, period: period, amount: 30, claimed: 0}
        ]
      );

      const terms:VestingTerms = await vesting.getVestingTerms(user);
      expect(terms.amount).to.equal(60);
      expect(terms.startTime).to.equal(startTime + 1);
      expect(terms.period).to.equal(period - 1);
      expect(terms.claimed).to.equal(0);

      const terms2:VestingTerms = await vesting.getVestingTerms(user2);
      expect(terms2.amount).to.equal(30);
      expect(terms2.startTime).to.equal(startTime);
      expect(terms2.period).to.equal(period);
      expect(terms2.claimed).to.equal(0);

      expect(await token.balanceOf(owner)).to.equal(210);
    });

    it("Expected state after stopVesting (after period)", async () => {
      const startTime = await blockTimestamp();
      const period = DAY * 30;
      await vesting.startVesting(
        owner,
        user,
        {startTime: startTime, period: period, amount: 30, claimed: 0}
      );
      await setEvmTime(startTime + period);
      expect(await vesting.stopVesting(owner, user)).to.emit(
        vesting.contract, 
        "VestingRemoved"
      ).withArgs(addressOf(user));
  
      const terms:VestingTerms = await vesting.getVestingTerms(user);
      expect(terms.amount).to.equal(0);
      expect(terms.startTime).to.equal(0);
      expect(terms.period).to.equal(0);
      expect(terms.claimed).to.equal(0);

      expect(await vesting.claimable(user)).to.equal(0);

      expect(await token.balanceOf(user)).to.equal(0);
      expect(await token.balanceOf(owner)).to.equal(300);
    });

    it("Expected state after stopVesting called after vesting period expires and all tokens claimed", async () => {
      const startTime = await blockTimestamp();
      const period = DAY;
      await vesting.startVesting(
        owner,
        user,
        {startTime: startTime, period: period, amount: 30, claimed: 0}
      );
      await increaseTime(DAY);
      await vesting.claim(user);
      expect(await token.balanceOf(user)).to.equal(30);
      
      await vesting.stopVesting(owner, user);
  
      const terms:VestingTerms = await vesting.getVestingTerms(user);
      expect(terms.amount).to.equal(0);
      expect(terms.startTime).to.equal(0);
      expect(terms.period).to.equal(0);
      expect(terms.claimed).to.equal(0);

      expect(await vesting.claimable(user)).to.equal(0);

      expect(await token.balanceOf(user)).to.equal(30);
      expect(await token.balanceOf(owner)).to.equal(270);
    });

    it("Claiming after period finished", async () => {
      const startTime = await blockTimestamp();
      const period = DAY;
      await vesting.startVesting(
        owner,
        user,
        {startTime: startTime, period: period, amount: 30, claimed: 0}
      );

      await increaseTime(period * 2);
      const amountToClaim = await vesting.claimable(user);
      expect(await vesting.claim(user, amountToClaim)).to.emit(
        vesting.contract,
        "VestingClaimed"
      ).withArgs(addressOf(user), vesting.toBigNum(amountToClaim));
      expect(await token.balanceOf(user)).to.equal(30);
    });

    it("Claiming specific amount after half period", async () => {
      const startTime = await blockTimestamp();
      const period = DAY;
      await vesting.startVesting(
        owner,
        user,
        {startTime: startTime, period: period, amount: 30, claimed: 0}
      );

      await increaseTime(period / 2);
      await vesting.claim(user, 7);
      expect(+await token.balanceOf(user)).to.equal(7);
    });

    it("Claiming maximum (with helper) after half period", async () => {
      const startTime = await blockTimestamp();
      const period = DAY;
      await vesting.startVesting(
        owner,
        user,
        {startTime: startTime, period: period, amount: 30, claimed: 0}
      );

      await increaseTime(period / 2);
      await vesting.claim(user, await vesting.claimable(user));
      expect(+await token.balanceOf(user)).to.be.within(15, 15.1);
    });

    it("Claiming maximum after half period", async () => {
      const startTime = await blockTimestamp();
      const period = DAY;
      await vesting.startVesting(
        owner,
        user,
        {startTime: startTime, period: period, amount: 30, claimed: 0}
      );

      await increaseTime(period / 2);
      await vesting.claim(user)
      expect(+await token.balanceOf(user)).to.be.within(15, 15.1);
    });

    it("Claiming twice within period", async () => {
      const startTime = await blockTimestamp();
      const period = DAY;
      await vesting.startVesting(
        owner,
        user,
        {startTime: startTime, period: period, amount: 30, claimed: 0}
      );

      await increaseTime(period / 2);

      await vesting.claim(user, 7);
      expect(+await token.balanceOf(user)).to.equal(7);

      await vesting.claim(user, 7);
      expect(+await token.balanceOf(user)).to.equal(14);

      expect(+await vesting.claimable(user)).to.be.within(1, 1.1);
    });

  });

  describe("Transfer vesting", async () => {
    it("Expected state after transferVesting", async () => {
      const startTime = await blockTimestamp();
      const period = DAY * 30;
      await vesting.startVesting(
        owner,
        user,
        {startTime: startTime, period: period, amount: 30, claimed: 0}
      );
      expect(await token.balanceOf(owner)).to.equal(270);

      expect(await vesting.transferVesting(owner, user, user2)).to.emit(
        vesting.contract, 
        "VestingTransferred"
      ).withArgs(addressOf(user), addressOf(user2));

      const terms1:VestingTerms = await vesting.getVestingTerms(user);
      expect(terms1.amount).to.equal(0);
      expect(terms1.startTime).to.equal(0);
      expect(terms1.period).to.equal(0);
      expect(terms1.claimed).to.equal(0);

      const terms2:VestingTerms = await vesting.getVestingTerms(user2);
      expect(terms2.amount).to.equal(30);
      expect(terms2.startTime).to.equal(startTime);
      expect(terms2.period).to.equal(period);
      expect(terms2.claimed).to.equal(0);
    });

    it("Transfer between two claims", async () => {
      const startTime = await blockTimestamp();
      const period = DAY * 30;
      await vesting.startVesting(
        owner,
        user,
        {startTime: startTime, period: period, amount: 30, claimed: 0}
      );
      expect(await token.balanceOf(owner)).to.equal(270);

      await increaseTime(period / 2);
      await vesting.claim(user, await vesting.claimable(user));
      expect(+await token.balanceOf(user)).to.be.within(15, 15.1);

      await vesting.transferVesting(owner, user, user2);

      await increaseTime(period / 2);
      await vesting.claim(user2, await vesting.claimable(user2));
      expect(+await token.balanceOf(user2)).to.be.within(14.9, 15);

      const terms1:VestingTerms = await vesting.getVestingTerms(user);
      expect(terms1.amount).to.equal(0);
      expect(terms1.startTime).to.equal(0);
      expect(terms1.period).to.equal(0);
      expect(terms1.claimed).to.equal(0);

      const terms2:VestingTerms = await vesting.getVestingTerms(user2);
      expect(terms2.amount).to.equal(30);
      expect(terms2.startTime).to.equal(startTime);
      expect(terms2.period).to.equal(period);
      expect(terms2.claimed).to.equal(30);
    });

    it("Expected state after transferVesting", async () => {
      const startTime = await blockTimestamp();
      const period = DAY * 30;
      await vesting.startVesting(
        owner,
        user,
        {startTime: startTime, period: period, amount: 30, claimed: 0}
      );
      await vesting.startVesting(
        owner,
        user2,
        {startTime: startTime + 10, period: period + 10, amount: 10, claimed: 0}
      );
      expect(await token.balanceOf(owner)).to.equal(260);

      (await expectRevert(vesting.transferVesting(owner, user, user2))).to.equal("Vesting already started for receiver.");

      const terms1:VestingTerms = await vesting.getVestingTerms(user);
      expect(terms1.amount).to.equal(30);
      expect(terms1.startTime).to.equal(startTime);
      expect(terms1.period).to.equal(period);
      expect(terms1.claimed).to.equal(0);

      const terms2:VestingTerms = await vesting.getVestingTerms(user2);
      expect(terms2.amount).to.equal(10);
      expect(terms2.startTime).to.equal(startTime + 10);
      expect(terms2.period).to.equal(period + 10);
      expect(terms2.claimed).to.equal(0);
    });
  });

});