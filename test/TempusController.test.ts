import { expect } from "chai";
import { addressOf, Signer } from "./utils/ContractBase";
import { TempusAMMJoinKind } from "./utils/TempusAMM";
import { expectRevert } from "./utils/Utils";
import { PoolType, TempusPool } from "./utils/TempusPool";
import { TempusController } from "./utils/TempusController";
import { describeForEachPool, integrationExclusiveIt as it } from "./pool-utils/MultiPoolTestSuite";
import { PoolTestFixture } from "./pool-utils/PoolTestFixture";
import { BigNumber } from "@ethersproject/bignumber";
import Decimal from "decimal.js";
import { TempusPoolAMM } from "./utils/TempusPoolAMM";
import { NumberOrString } from "./utils/Decimal";

const SWAP_LIMIT_ERROR_MESSAGE = "BAL#507";

describeForEachPool("TempusController", (testPool:PoolTestFixture) =>
{
  let owner:Signer, user1:Signer, user2:Signer;
  let pool:TempusPool;
  let amm:TempusPoolAMM;
  let controller:TempusController;

  beforeEach(async () =>
  {
    pool = await testPool.createDefault();
    [owner, user1, user2] = testPool.signers;

    amm = testPool.amm;
    controller = testPool.tempus.controller;
    await testPool.setupAccounts(owner, [[user1,/*ybt*/1000000],[user2,/*ybt*/100000]]);
  });

  async function getAMMBalancesRatio(): Promise<BigNumber>
  {
    const principals = await pool.principalShare.balanceOf(amm.vault.address);
    const yields = await pool.yieldShare.balanceOf(amm.vault.address);
    return amm.toBigNum(1.0).mul(amm.toBigNum(principals)).div(amm.toBigNum(yields));
  }

  function getDefaultLeftoverShares(): NumberOrString
  {
    if (pool.principalShare.decimals == 18) {
      return "0.000001";
    } else if (pool.principalShare.decimals == 6) {
      return "0.01";
    } else {
      throw new Error("Cannot set default leftoverShares for token with decimals=" + pool.principalShare.decimals);
    }
  }

  // pre-initialize AMM liquidity
  async function initAMM(user:Signer, ybtDeposit:number, principals:number, yields:number)
  {
    await controller.depositYieldBearing(user, pool, ybtDeposit, user);
    await amm.provideLiquidity(user1, principals, yields, TempusAMMJoinKind.INIT);
  }

  async function expectValidState(expectedAMMBalancesRatio:BigNumber = null)
  {
    if (expectedAMMBalancesRatio) {
      expect(await getAMMBalancesRatio()).to.equal(expectedAMMBalancesRatio, "AMM balances must maintain the same ratio");
    }
    expect(+await pool.principalShare.balanceOf(controller.address)).to.be.lessThan(2e-18, "No funds should remain in controller");
    expect(+await pool.yieldShare.balanceOf(controller.address)).to.be.lessThan(2e-18, "No funds should remain in controller");
  }

  describe("deploy", async () => {
    it("Version is correct", async () =>
    {
      const { major, minor, patch } = await controller.version();
      expect(major).to.equal(1);
      expect(minor).to.equal(1);
      expect(patch).to.equal(0);
    });

    it("Owner is correct", async () =>
    {
      expect(await controller.owner()).to.equal(addressOf(owner));
    });
  });
  
  describe("depositAndProvideLiquidity", () =>
  {
    it("unauthorized contracts are not allowed", async () =>
    {
      await controller.register(owner, pool.address, /*isValid:*/false);
      (await testPool.expectDepositBT(user1, 1.0)).to.equal("Unauthorized contract address");
    });

    it("deposit YBT and provide liquidity to a pre-initialized AMM", async () =>
    {
      await initAMM(user1, /*ybtDeposit*/1200, /*principals*/120, /*yields*/1200);

      const ratioBefore = await getAMMBalancesRatio();
      await controller.depositAndProvideLiquidity(testPool, user2, 500, /*isBackingToken:*/false);
      await expectValidState(ratioBefore);
      
      expect(+await amm.balanceOf(user2)).to.be.greaterThan(0, "pool tokens must be issued to the user");
      expect(+await pool.principalShare.balanceOf(user2)).to.be.greaterThan(0, "Some Principals should be returned to user");
      expect(+await pool.yieldShare.balanceOf(user2)).to.be.equal(0, "ALL Yields should be deposited to AMM");
    });

    it("deposit BT and provide liquidity to a pre-initialized AMM", async () =>
    {
      await initAMM(user1, /*ybtDeposit*/100, /*principals*/1.2, /*yields*/12);

      const ratioBefore = await getAMMBalancesRatio();
      const ethAmount = testPool.type == PoolType.Lido ? 50 : 0;
      await controller.depositAndProvideLiquidity(testPool, user2, 50, true, ethAmount);
      await expectValidState(ratioBefore);

      expect(+await amm.balanceOf(user2)).to.be.greaterThan(0, "pool tokens must be issued to the user");
      expect(+await pool.principalShare.balanceOf(user2)).to.be.greaterThan(0, "Some Principals should be returned to user");
      expect(+await pool.yieldShare.balanceOf(user2)).to.be.equal(0, "ALL Yields should be deposited to AMM");
    });

    it("deposit YBT and provide liquidity to a pre-initialized AMM with more then 100% yield estimate [ @skip-on-coverage ]", async () =>
    {
      await testPool.setInterestRate(10.0);
      await initAMM(user1, /*ybtDeposit*/1200, /*principals*/120, /*yields*/12);

      const ratioBefore = await getAMMBalancesRatio();
      await controller.depositAndProvideLiquidity(testPool, user2, 100, false); 
      await expectValidState(ratioBefore);

      expect(+await amm.balanceOf(user2)).to.be.greaterThan(0, "pool tokens must be issued to the user");
      expect(+await pool.principalShare.balanceOf(user2)).to.be.equal(0, "ALL Principals should be deposited to AMM");
      expect(+await pool.yieldShare.balanceOf(user2)).to.be.greaterThan(0, "Some Yields should be returned to user");
    });

    it("verifies depositing YBT and providing liquidity to a non initialized AMM reverts", async () =>
    {
      const invalidAction = controller.depositAndProvideLiquidity(testPool, user1, 123, false);
      (await expectRevert(invalidAction)).to.equal("AMM not initialized");
    });

    it("verifies depositing ERC20 BT and providing liquidity to a non initialized AMM reverts", async () =>
    {
      const invalidAction = controller.depositAndProvideLiquidity(testPool, user1, 123, true);
      (await expectRevert(invalidAction)).to.equal("AMM not initialized");
    });

    it("verifies depositing 0 YBT and providing liquidity reverts", async () =>
    {
      await initAMM(user1, /*ybtDeposit*/2000, /*principals*/12.34567, /*yields*/1234.567891);
      const invalidAction = controller.depositAndProvideLiquidity(testPool, user2, 0, false);
      (await expectRevert(invalidAction)).to.equal("yieldTokenAmount is 0");
    });
  });

  describe("depositAndFix", () =>
  {
    it("verifies tx reverts if provided minimum TYS rate requirement is not met", async () =>
    {
      await initAMM(user1, /*ybtDeposit*/2000, /*principals*/200, /*yields*/2000); // 10% rate
      const minTYSRate = "0.11";
      const invalidAction = controller.depositAndFix(testPool, user2, 5.456789, false, minTYSRate); 

      (await expectRevert(invalidAction)).to.equal(SWAP_LIMIT_ERROR_MESSAGE);
    });

    it("verifies depositing YBT succeeds if provided minimum TYS rate requirement is met", async () =>
    {
      await initAMM(user1, /*ybtDeposit*/2000, /*principals*/200, /*yields*/2000); // 10% rate
      const minTYSRate = "0.097"; // 9.7% (fee + slippage)
      await controller.depositAndFix(testPool, user2, 5.456789, false, minTYSRate); 
      await expectValidState();

      expect(+await pool.principalShare.balanceOf(user2)).to.be.greaterThan(0, "Some Principals should be returned to user");
      expect(+await pool.yieldShare.balanceOf(user2)).to.be.equal(0, "ALL Yields should be deposited to AMM");
    });

    it("verifies depositing BT succeeds if provided minimum TYS rate requirement is met", async () =>
    {
      await initAMM(user1, /*ybtDeposit*/2000, /*principals*/20, /*yields*/200); // 10% rate
      const minTYSRate = "0.097"; // 9.7% (fee + slippage)
      const amount = 5.456789;
      const ethAmount = testPool.type == PoolType.Lido ? amount : 0;
      await controller.depositAndFix(testPool, user2, 5.456789, true, minTYSRate, ethAmount); 
      await expectValidState();

      expect(+await pool.principalShare.balanceOf(user2)).to.be.greaterThan(0, "Some Principals should be returned to user");
      expect(+await pool.yieldShare.balanceOf(user2)).to.be.equal(0, "ALL Yields should be deposited to AMM");
    });
  });

  describe("depositAndLeverage", () =>
  {
    it("verifies tx reverts if provided minimum Capitals rate requirement is not met", async () =>
    {
      await initAMM(user1, /*ybtDeposit*/2000, /*principals*/200, /*yields*/2000); // 10% rate
      const invalidAction = controller.depositAndLeverage(
        testPool,
        user2,
        5.456789,   // ampunt
        false,      // isBackingToken
        2,          // leverageMultiplier
        20          // minCapitalsRate
      ); 

      (await expectRevert(invalidAction)).to.equal(SWAP_LIMIT_ERROR_MESSAGE);
    });

    it("verifies depositing YBT succeeds", async () =>
    {
      await initAMM(user1, /*ybtDeposit*/2000, /*principals*/200, /*yields*/2000); // 10% rate
      const minCapitalsRate = "9.7";
      await controller.depositAndLeverage(testPool, user2, 5.456789, false, 2, minCapitalsRate); 
      await expectValidState();

      expect(+await pool.principalShare.balanceOf(user2)).to.be.lessThan(5.456789, "Some Principals are swapped");
      expect(+await pool.yieldShare.balanceOf(user2)).to.be.greaterThan(10, "Yields are leveraged");
    });

    it("verifies depositing BT succeeds", async () =>
    {
      await initAMM(user1, /*ybtDeposit*/2000, /*principals*/20, /*yields*/200); // 10% rate
      const minCapitalsRate = "9.7";
      const amount = 5.456789;
      const ethAmount = testPool.type == PoolType.Lido ? amount : 0;
      await controller.depositAndLeverage(testPool, user2, 5.456789, true, 2, minCapitalsRate, ethAmount); 
      await expectValidState();

      expect(+await pool.principalShare.balanceOf(user2)).to.be.lessThan(5.456789, "Some Principals are swapped");
      expect(+await pool.yieldShare.balanceOf(user2)).to.be.greaterThan(10, "Yields are leveraged");
    });
  });

  describe("provideLiquidity", () =>
  {
    it("check lp provided", async () =>
    {
      await initAMM(user1, /*ybtDeposit*/2000, /*principals*/100, /*yields*/1000); // 10% rate
      await controller.provideLiquidity(testPool, user1, 1000);
      expect(+await pool.principalShare.balanceOf(user1)).to.be.greaterThan(0, "Some Principals should be returned to user");
      expect(+await pool.yieldShare.balanceOf(user1)).to.be.equal(0, "ALL Yields should be deposited to AMM");
      expect(+await testPool.amm.balanceOf(user1)).to.be.greaterThan(0, "Should have some LP tokens");
    });
  });

  describe("Exit AMM", () =>
  {
    it("ExitAMM after maturity", async () =>
    {
      await initAMM(user1, /*ybtDeposit*/1000000, /*principals*/100000, /*yields*/1000000);
      const beforeExitBalanceLP:number = +await testPool.amm.balanceOf(user1);
      const totalSupply:number = +await testPool.amm.totalSupply();
      expect(beforeExitBalanceLP).to.be.within(181000, 182000);
      await testPool.setInterestRate(1.1);
      await testPool.fastForwardToMaturity();
      await controller.exitTempusAmm(testPool, user1, 100000);
      const redeemPercent:number = 100000 / totalSupply;
      expect(+await testPool.amm.balanceOf(user1)).to.be.within(81000, 82000);
      expect(+await testPool.yields.balanceOf(user1)).to.be.within(0.999999 * redeemPercent * 1000000, 1.000001 * redeemPercent * 1000000);
      // user already had 900000 because he provided liquidity with 100000 only
      const redeemedPrincipals = (+await testPool.principals.balanceOf(user1)) - 900000;
      expect(redeemedPrincipals).to.be.within(0.999999 * redeemPercent * 100000, 1.000001 * redeemPercent * 100000);
    });
  });

  describe("Exit AMM and Reedem", () => 
  {
    it("Exit AMM and redeem before maturity", async () => 
    {
      await initAMM(user1, /*ybtDeposit*/1000000, /*principals*/100000, /*yields*/1000000);

      await controller.depositYieldBearing(user2, pool, 10000, user2);
      await testPool.amm.provideLiquidity(user2, 1000, 10000, TempusAMMJoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT);
      
      const userP:number = +await testPool.principals.balanceOf(user2);
      const userY:number = +await testPool.yields.balanceOf(user2);
      const userPRedeem:number = userP < 9999 ? userP : 9999;
      const userYRedeem:number = userY < 9999 ? userY : 9999;
      await controller.exitAmmGivenAmountsOutAndEarlyRedeem(
        testPool, 
        user2, 
        userPRedeem,
        userYRedeem,
        9999 - userPRedeem, 
        9999 - userYRedeem,
        false
      );
      expect(await pool.yieldShare.balanceOf(user2)).to.equal(0);
      expect(await pool.principalShare.balanceOf(user2)).to.equal(0);
      expect(+await amm.balanceOf(user2)).to.be.within(0.991, 0.993);
      expect(await pool.yieldBearing.balanceOf(user2)).to.equal(99999);
    });

    it("Exit AMM and redeem to backing before maturity", async () => 
    {
      await initAMM(user1, /*ybtDeposit*/1000000, /*principals*/100000, /*yields*/1000000);
      await controller.depositYieldBearing(user2, pool, 10000, user2);
      await testPool.amm.provideLiquidity(user2, 1000, 10000, TempusAMMJoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT);
      const userP:number = +await testPool.principals.balanceOf(user2);
      const userY:number = +await testPool.yields.balanceOf(user2);
      const userPRedeem:number = userP < 9999 ? userP : 9999;
      const userYRedeem:number = userY < 9999 ? userY : 9999;
      const reedemAction = controller.exitAmmGivenAmountsOutAndEarlyRedeem(
        testPool, 
        user2, 
        userPRedeem,
        userYRedeem,
        9999 - userPRedeem,
        9999 - userYRedeem, 
        true
      );
      if (testPool.type === PoolType.Lido) {
        (await expectRevert(reedemAction)).to.equal("LidoTempusPool.withdrawFromUnderlyingProtocol not supported");
      }
      else {
        await reedemAction;
        expect(await pool.yieldShare.balanceOf(user2)).to.equal(0);
        expect(await pool.principalShare.balanceOf(user2)).to.equal(0);
        expect(+await amm.balanceOf(user2)).to.be.within(0.991, 0.993);
        expect(await testPool.asset.balanceOf(user2)).to.equal(109999);
      }
    });

    it("Exit AMM and redeem after maturity should revert", async () => 
    {
      await initAMM(user1, /*ybtDeposit*/1000000, /*principals*/100000, /*yields*/1000000);
      await testPool.fastForwardToMaturity();

      (await expectRevert(controller.exitAmmGivenAmountsOutAndEarlyRedeem(
        testPool, 
        user2, 
        100000, 
        100000,
        0,
        0,
        false
      ))).to.equal(
        "Pool already finalized"
      );
    });
  });

  describe("Complete Exit", () => 
  {
    it("Complete exit before maturity maxLeftoverShares too big", async () =>
    {
      await initAMM(user1, /*ybtDeposit*/1000000, /*principals*/100000, /*yields*/1000000);
      
      await testPool.controller.depositAndFix(testPool, owner, 100, false, 0);

      (await expectRevert(controller.exitAmmGivenLpAndRedeem(
        testPool, 
        owner, 
        0, // lp tokens
        await testPool.principals.balanceOf(owner),
        0, // yields
        false,
        await testPool.principals.balanceOf(owner)
      ))).to.equal("maxLeftoverShares too big");
    });

    it("Complete exit before maturity", async () => 
    {
      await initAMM(user1, /*ybtDeposit*/1000000, /*principals*/100000, /*yields*/1000000);
      
      const preBalanceUser2 = +await testPool.ybt.balanceOf(user2);
      const preBalanceOwner = +await testPool.ybt.balanceOf(owner);
      await testPool.controller.depositAndProvideLiquidity(testPool, user2, 10000, false);
      await testPool.controller.depositAndFix(testPool, owner, 100, false, 0);

      await controller.exitAmmGivenLpAndRedeem(
        testPool, 
        user2, 
        await testPool.amm.balanceOf(user2), 
        await testPool.principals.balanceOf(user2),
        await testPool.yields.balanceOf(user2), 
        false,
        getDefaultLeftoverShares()
      );
      await controller.exitAmmGivenLpAndRedeem(
        testPool, 
        owner, 
        await testPool.amm.balanceOf(owner), 
        await testPool.principals.balanceOf(owner),
        await testPool.yields.balanceOf(owner), 
        false,
        getDefaultLeftoverShares()
      );

      const postBalanceUser2 = +await testPool.ybt.balanceOf(user2);
      const postBalanceOwner = +await testPool.ybt.balanceOf(owner);

      expect(postBalanceOwner).to.be.within(preBalanceOwner - 1, preBalanceOwner + 1);
      expect(postBalanceUser2).to.be.within(preBalanceUser2 - 1, preBalanceUser2 + 1);
    });

    it("Complete exit before maturity with equal shares", async () => 
    {
      await initAMM(user1, /*ybtDeposit*/1000000, /*principals*/100000, /*yields*/1000000);
      
      const preBalanceOwner = +await testPool.ybt.balanceOf(owner);
      await testPool.controller.depositYieldBearing(owner, testPool.tempus, 100);

      await controller.exitAmmGivenLpAndRedeem(
        testPool, 
        owner, 
        0,
        await testPool.principals.balanceOf(owner),
        await testPool.yields.balanceOf(owner), 
        false,
        getDefaultLeftoverShares()
      );

      const postBalanceOwner = +await testPool.ybt.balanceOf(owner);

      expect(postBalanceOwner).to.be.within(preBalanceOwner - 1, preBalanceOwner + 1);
    });

    it("Should successfully swap Yields --> Principals w/ 3% Maximum Slippage", async () => 
    {
      await initAMM(user1, /*ybtDeposit*/1000000, /*principals*/100000, /*yields*/1000000);
      await testPool.controller.depositYieldBearing(owner, testPool.tempus, 100);

      expect(await controller.exitAmmGivenLpAndRedeem(
        testPool, 
        owner, 
        0, 
        0,
        await testPool.yields.balanceOf(owner),
        false,
        getDefaultLeftoverShares(),
        await calculateCurrentYieldsRate(),
        0.03
      )).to.emit(testPool.amm.vault, 'Swap');;
    });
    
    it("Should successfully swap Principals --> Yields w/ 3% Maximum Slippage", async () => 
    {
      await initAMM(user1, /*ybtDeposit*/1000000, /*principals*/100000, /*yields*/1000000);
      await testPool.controller.depositYieldBearing(owner, testPool.tempus, 100);

      expect(await controller.exitAmmGivenLpAndRedeem(
        testPool, 
        owner, 
        0, 
        await testPool.principals.balanceOf(owner),
        0,
        false,
        getDefaultLeftoverShares(),
        await calculateCurrentYieldsRate(),
        0.03
      )).to.emit(testPool.amm.vault, 'Swap');
    });

    it("Should fail swap due to minimum return Principals --> Yields w/ 0.1% Maximum Slippage", async () => 
    {
      await initAMM(user1, /*ybtDeposit*/1000000, /*principals*/100000, /*yields*/1000000);
      await testPool.controller.depositYieldBearing(owner, testPool.tempus, 100);

      await expect(controller.exitAmmGivenLpAndRedeem(
        testPool, 
        owner, 
        0, 
        await testPool.principals.balanceOf(owner),
        0,
        false,
        getDefaultLeftoverShares(),
        await calculateCurrentYieldsRate(),
        "0.001"
      )).to.be.revertedWith("BAL#507");
    });

    it("Should fail swap due to minimum return Yields --> Principals w/ 0.1% Maximum Slippage", async () => 
    {
      await initAMM(user1, /*ybtDeposit*/1000000, /*principals*/100000, /*yields*/1000000);
      await testPool.controller.depositYieldBearing(owner, testPool.tempus, 100);

      await expect(controller.exitAmmGivenLpAndRedeem(
        testPool, 
        owner, 
        0, 
        0,
        await testPool.yields.balanceOf(owner),
        false,
        getDefaultLeftoverShares(),
        await calculateCurrentYieldsRate(),
        "0.001"
      )).to.be.revertedWith("BAL#507");
    });

    it("Should fail with yieldsRate = 0", async () => 
    {
      await initAMM(user1, /*ybtDeposit*/1000000, /*principals*/100000, /*yields*/1000000);
      await testPool.controller.depositYieldBearing(owner, testPool.tempus, 100);

      const yieldsRate = 0;
      await expect(controller.exitAmmGivenLpAndRedeem(
        testPool, 
        owner, 
        0, 
        0,
        await testPool.yields.balanceOf(owner),
        false,
        getDefaultLeftoverShares(),
        yieldsRate,
        "0.001"
      )).to.be.revertedWith("yieldsRate must be greater than 0");
    });

    it("Should fail with maxSlippage > 1e18", async () => 
    {
      await initAMM(user1, /*ybtDeposit*/1000000, /*principals*/100000, /*yields*/1000000);
      await testPool.controller.depositYieldBearing(owner, testPool.tempus, 100);

      await expect(controller.exitAmmGivenLpAndRedeem(
        testPool, 
        owner, 
        0, 
        0,
        await testPool.yields.balanceOf(owner),
        false,
        getDefaultLeftoverShares(),
        await calculateCurrentYieldsRate(),
        "1.000000000000000001"
      )).to.be.revertedWith("maxSlippage can not be greater than 1e18");
    });

    it("Complete exit to yield bearing", async () => 
    {
      await initAMM(user1, /*ybtDeposit*/1000000, /*principals*/100000, /*yields*/1000000);
      expect(await testPool.yields.balanceOf(user1)).to.equal(0, "all yields are in amm");
      expect(await testPool.principals.balanceOf(user1)).to.equal(
        900000, 
        "balance should decrease as there is some of it locked in amm"
      );
      expect(+await testPool.amm.balanceOf(user1)).to.be.within(181000, 182000);
      
      await testPool.setInterestRate(1.1);
      await testPool.fastForwardToMaturity();

      expect(await testPool.ybt.balanceOf(user1)).to.equal(0);

      await controller.exitAmmGivenLpAndRedeem(
        testPool, 
        user1, 
        await testPool.amm.balanceOf(user1), 
        await testPool.principals.balanceOf(user1),
        await testPool.yields.balanceOf(user1),
        false,
        getDefaultLeftoverShares()
      );

      expect(await testPool.yields.balanceOf(user1)).to.equal(0);
      expect(await testPool.principals.balanceOf(user1)).to.equal(0);
      expect(await testPool.amm.contract.balanceOf(user1.address)).to.equal(0);
      if (testPool.yieldPeggedToAsset) {
        expect(+await testPool.ybt.balanceOf(user1)).to.be.within(1099000, 1101000);
      } else {
        expect(+await testPool.ybt.balanceOf(user1)).to.be.within(999000, 1001000);
      }

    });

    it("Complete exit to backing", async () => 
    {
      await initAMM(user1, /*ybtDeposit*/1000000, /*principals*/100000, /*yields*/1000000);
      expect(await pool.yieldShare.balanceOf(user1)).to.equal(0, "all yields are in amm");
      expect(await pool.principalShare.balanceOf(user1)).to.equal(
        900000,
        "balance should decrease as there is some of it locked in amm"
      );
      expect(+await testPool.amm.balanceOf(user1)).to.be.within(181000, 182000);

      await testPool.setInterestRate(1.1);
      await testPool.fastForwardToMaturity();

      if (testPool.type == PoolType.Lido)
      {
        (await expectRevert(controller.exitAmmGivenLpAndRedeem(
          testPool, 
          user1, 
          await testPool.amm.balanceOf(user1), 
          await testPool.principals.balanceOf(user1),
          await testPool.yields.balanceOf(user1),
          true,
          getDefaultLeftoverShares()
        ))).to.equal(
          "LidoTempusPool.withdrawFromUnderlyingProtocol not supported"
        );
      }
      else
      {
        expect(await testPool.asset.balanceOf(user1)).to.equal(100000);
        await controller.exitAmmGivenLpAndRedeem(
          testPool, 
          user1, 
          await testPool.amm.balanceOf(user1), 
          await testPool.principals.balanceOf(user1),
          await testPool.yields.balanceOf(user1),
          true,
          getDefaultLeftoverShares()
        );
        expect(await pool.yieldShare.balanceOf(user1)).to.equal(0);
        expect(await pool.principalShare.balanceOf(user1)).to.equal(0);
        expect(await testPool.amm.contract.balanceOf(user1.address)).to.equal(0);
        expect(+await testPool.asset.balanceOf(user1)).to.be.within(1199000, 1200000);
      }
    });
  });

  async function calculateCurrentYieldsRate(): Promise<string> {
    const pricePerYield = await testPool.yields.getPricePerFullShareStored();
    const pricePerPrincipal = await testPool.principals.getPricePerFullShareStored();
    
    return new Decimal(pricePerYield.toString()).div(pricePerPrincipal.toString()).toFixed(testPool.principals.decimals); /// TODO: move Decimal.js usage to a separate math helper
  }
});
