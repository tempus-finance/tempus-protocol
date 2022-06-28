import { ethers } from "hardhat";
import { expect } from "chai";
import { blockTimestamp, expectRevert, increaseTime } from "@tempus-labs/utils/ts/utils/Utils";
import { Signer } from "@tempus-labs/utils/ts/utils/ContractBase";
import { TempusToken } from "@tempus-sdk/tempus/TempusToken";
import { DAY } from "@tempus-sdk/tempus/TempusAMM";
import { describeNonPool } from "../pool-utils/MultiPoolTestSuite";

describeNonPool("Tempus Token", async () => {
  let owner:Signer, user1:Signer, user2:Signer;
  let token:TempusToken;
  let deploymentTime:number;
  const MINTING_ALLOWED_FIRST_AFTER_PERIOD = 365 * DAY * 4;

  beforeEach(async () => {
    [owner, user1, user2] = await ethers.getSigners();
    deploymentTime = await blockTimestamp();
    token = await TempusToken.deployClass(TempusToken);
  });

  describe("Deploy", async () =>
  {
    it("Should set correct minting times", async () =>
    {
      expect(await token.lastMintingTime()).gte(deploymentTime);
      expect(await token.mintingAllowedAfter()).gte(deploymentTime + MINTING_ALLOWED_FIRST_AFTER_PERIOD);
      expect(await token.INITIAL_SUPPLY()).to.equal(token.toBigNum(1_000_000_000));
      expect(await token.MINT_CAP()).to.equal(2);
      expect(await token.MIN_TIME_BETWEEN_MINTS()).to.equal(DAY * 365);
    });
    it("Should mint initial supply to owner", async () =>
    {
      expect(+await token.balanceOf(owner)).to.equal(1e9);
      expect(+await token.totalSupply()).to.equal(1e9);
    });

    it("Should set name and symbol", async () =>
    {
      expect(await token.name()).to.equal("Tempus");
      expect(await token.symbol()).to.equal("TEMP");
    });
  });
  
  describe("Burn", async () =>
  {
    it("Should allow users to burn their own tokens", async () =>
    {
      const amount = 10;
      const initialTotalSupply = await token.totalSupply();

      await token.transfer(owner, user1, amount); // Owner transfers to User
      expect(+await token.balanceOf(user1)).to.equal(amount);

      // User tries to burn its own tokens
      await token.burn(user1, amount);
      expect(+await token.balanceOf(user1)).to.equal(0);
      expect(+await token.totalSupply()).to.equal(+initialTotalSupply - amount);
    });
  });

  describe("Mint", async () =>
  {
    it("Should revert on minting", async () =>
    {
      (await expectRevert(token.mint(user1, user1, 2e7))).to.equal("Ownable: caller is not the owner");
      (await expectRevert(token.mint(owner, user1, 2e7))).to.equal("Minting not allowed yet.");
      await increaseTime(MINTING_ALLOWED_FIRST_AFTER_PERIOD);
      (await expectRevert(token.mint(owner, user1, 2e8))).to.equal("Mint cap limit.");
      (await expectRevert(
        token.mint(owner, "0x0000000000000000000000000000000000000000", 2e7)
      )).to.equal("Can not mint to 0x0.");
      await token.mint(owner, user1, 2e7);
      (await expectRevert(token.mint(owner, user1, 2e7))).to.equal("Not enough time between mints.");
    });

    it("Mint should increase total supply correctly", async () =>
    {
      const initialSupply = 1e9;
      await increaseTime(MINTING_ALLOWED_FIRST_AFTER_PERIOD);
      const lastMintTime = await blockTimestamp();
      const firstMintAmount = 2e7;
      await token.mint(owner, user1, firstMintAmount.toString());
      expect(await token.lastMintingTime()).gte(lastMintTime);
      expect(+await token.balanceOf(user1)).to.equal(firstMintAmount);
      expect(+await token.totalSupply()).to.equal(initialSupply + firstMintAmount);
      
      await increaseTime(DAY * 365);
      const secontMintAmount = (initialSupply + firstMintAmount) / 50;
      await token.mint(owner, user1, secontMintAmount);
      expect(+await token.balanceOf(user1)).to.equal(firstMintAmount + secontMintAmount);
      expect(+await token.totalSupply()).to.equal(initialSupply + firstMintAmount + secontMintAmount);
    });
  });
});
