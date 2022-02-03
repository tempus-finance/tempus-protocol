import { expect } from "chai";
import {
  ethers,
  deployments,
  getNamedAccounts,
  getUnnamedAccounts
} from 'hardhat';
import { blockTimestamp } from '../test/utils/Utils';
import { generateTempusSharesNames, TempusPool } from "../test/utils/TempusPool";
import { ERC20 } from "../test/utils/ERC20";
import { TempusController } from "../test/utils/TempusController";
import { fromWei, parseDecimal, formatDecimal, toWei } from "../test/utils/Decimal";
import Decimal from "decimal.js";
import { BigNumberish } from "@ethersproject/bignumber";


const fixtures = {} // maps RariWithdrawalFee --> fixture 
async function setupWithRariWithdrawalFee(rariFee: BigNumberish) {
  if (!fixtures.hasOwnProperty(rariFee.toString())) {
    fixtures[rariFee.toString()] = deployments.createFixture(async () => {
      await deployments.fixture(undefined, {
        keepExistingDeployments: true, // global option to test network like that
      });
      
      const owner = (await ethers.getSigners())[0];
      const { usdcHolder, rariFundManagerOwner } = await getNamedAccounts();
      const [ account1, account2 ] = await getUnnamedAccounts();
      const usdcHolderSigner = await ethers.getSigner(usdcHolder);
      
      const usdcBackingToken = new ERC20("ERC20FixedSupply", 6, (await ethers.getContract('Usdc')));
      const rsptUsdcYieldToken = new ERC20("ERC20FixedSupply", 18, (await ethers.getContract('rsptUSDC')));
      
      const rariFundManager = await ethers.getContract("rariUsdcFundManager");
      const rariFundPriceConsumer = await ethers.getContract("rariFundPriceConsumer");
      
      if (Number(rariFee.toString()) > 0) {
        await owner.sendTransaction({ from: owner.address, to: rariFundManagerOwner, value: toWei(3) });
        // Set Rari's Withdrawal Fee
        await rariFundManager.connect(await ethers.getSigner(rariFundManagerOwner)).setWithdrawalFeeRate(rariFee);
      }
      
      const maturityTime = await blockTimestamp() + (60 * 60 * 24 * 30 * 3); // maturity is in 3 months
      const names = generateTempusSharesNames("USDC Rari Stable Pool Token", "RSPT", maturityTime);
      const yieldEst = 0.1;
      const controller: TempusController = await TempusController.deploy(owner);
      const tempusPool = await TempusPool.deployRari(
        owner, usdcBackingToken, rsptUsdcYieldToken, rariFundManager.address, controller, maturityTime, yieldEst, names
      );
      
      await usdcBackingToken.transfer(usdcHolderSigner, account1, 10000);
      await usdcBackingToken.transfer(usdcHolderSigner, account2, 10000);
      
      return {
        contracts: {
          rariFundManager,
          rariFundPriceConsumer,
          tempusPool,
          usdc: usdcBackingToken,
          rsptUsdc: rsptUsdcYieldToken
        },
        signers: {
          usdcHolder: usdcHolderSigner,
          signer1: await ethers.getSigner(account1),
          signer2: await ethers.getSigner(account2)
        }
      };
    })
  }

  return fixtures[rariFee.toString()]()
}

describe('TempusPool <> Rari', function () {
  describe('Verify deployment', () => {
    it ("Deployment", async () => {
      await setupWithRariWithdrawalFee(0);
    });
  });

  describe('Verifies that depositing directly to Rari accrues equal interest compared to depositing via TempusPool', async () => {
    it("0% Rari Withdrawal Fee", async () => {
      await testInterestDirectlyToProtocolMatchesViaTempus(0);
    });
    it("6% Rari Withdrawal Fee", async () => {
      await testInterestDirectlyToProtocolMatchesViaTempus(parseDecimal(6, 16));
    });
  });

  describe('Verifies that multiple deposits (from several users) followed by complete redemption of all funds empties the pool of the entire YBT balance', async () => {
    it("0% Rari Withdrawal Fee", async () => {
      await testMultipleDepositsFollowedByCompletePoolWithdrawalsEmptiesPoolFromYbt(0);
    });
    it("6% Rari Withdrawal Fee", async () => {
      await testMultipleDepositsFollowedByCompletePoolWithdrawalsEmptiesPoolFromYbt(parseDecimal(6, 16));
    });
  });


  async function testInterestDirectlyToProtocolMatchesViaTempus(rariFee) {
    // The maximum discrepancy to allow between accrued interest from depositing directly to Rari
    //   vs depositing to Rari via TempusPool
    const MAX_ALLOWED_INTEREST_DELTA_ERROR = 1e-6; // 0.0001% error
    const { signers: { usdcHolder, signer1, signer2 }, contracts: { usdc, rsptUsdc, rariFundManager, rariFundPriceConsumer, tempusPool }} = await setupWithRariWithdrawalFee(rariFee);
    
    expect(+await rsptUsdc.balanceOf(signer1)).to.equal(0);
    expect(+await rsptUsdc.balanceOf(signer2)).to.equal(0);
    
    const depositAmount: number = 100;
    
    await usdc.approve(signer1, tempusPool.controller.address, depositAmount);
    await usdc.approve(signer2, rariFundManager.address, depositAmount);
    await usdc.approve(signer2, tempusPool.controller.address, "1234.56789");
    
    await tempusPool.controller.depositBacking(signer2, tempusPool, "1234.56789"); // deposit some BT to the pool before 
    
    /// send directly to the Rari Fund Controller to emulate yield accumulation (which increases the interest rate).
    /// accrue some interest so that the pool interest rate increases from the initial
    await usdc.transfer(usdcHolder, (await rariFundManager.rariFundController()), "1204200.696969");  
    
    const btBalancePreSigner1 = await usdc.balanceOf(signer1.address);
    const btBalancePreSigner2 = await usdc.balanceOf(signer2.address);
    
    await tempusPool.controller.depositBacking(signer1, tempusPool, depositAmount); // deposit some BT to the pool before 
    await rariFundManager.connect(signer2).deposit("USDC", parseDecimal(depositAmount, 6)); // deposit directly to Rari
    
    /// send directly to the Rari Fund Controller to emulate yield accumulation (which increases the interest rate)
    await usdc.transfer(usdcHolder, (await rariFundManager.rariFundController()), "4204200.696969");
    
    const yieldShareBalanceSigner1 = await tempusPool.yieldShare.balanceOf(signer1);
    
    const usdValue = await rariFundManager.callStatic.balanceOf(signer2.address);  
    
    /// max withdrawal amount calculation is based the RariSDK implementation - https://github.com/Rari-Capital/RariSDK/blob/d6293e09c36a4ac6914725f5a5528a9c1e7cb178/src/Vaults/pools/stable.ts#L1775
    const usdcPriceInUsd = (await rariFundPriceConsumer.getCurrencyPricesInUsd())[1] /// USDC is index 1
    let usdcValue = usdValue.mul(parseDecimal(1, 6)).div(usdcPriceInUsd); /// apply USDC-USD rate
    if (usdcValue.mul(usdcPriceInUsd).div(parseDecimal(1, 6)).gt(usdValue)) {
      usdcValue = usdcValue.sub(1);
    }
    
    await rariFundManager.connect(signer2).withdraw("USDC", usdcValue); // withdraw directly from Rari 
    await tempusPool.controller.redeemToBacking(signer1, tempusPool, yieldShareBalanceSigner1, yieldShareBalanceSigner1, signer1.address);
    
    const btBalancePostSigner1 = await usdc.balanceOf(signer1);
    const btBalancePostSigner2 = await usdc.balanceOf(signer2);
    const totalInterestSigner1 = parseDecimal(btBalancePostSigner1, 6).sub(parseDecimal(btBalancePreSigner1, 6));
    const totalInterestSigner2 = parseDecimal(btBalancePostSigner2, 6).sub(parseDecimal(btBalancePreSigner2, 6));
    
    const error = new Decimal(1).sub(new Decimal(fromWei(totalInterestSigner2).toString())
      .div(fromWei(totalInterestSigner1).toString())).abs();
    
    expect(error.lessThanOrEqualTo(MAX_ALLOWED_INTEREST_DELTA_ERROR), `error is too high - ${error}`).to.be.true;
  }

  async function testMultipleDepositsFollowedByCompletePoolWithdrawalsEmptiesPoolFromYbt(rariFee) {
    // Defines the maximum amount of TempusPool YBT balance the is considered "dust"
    //        (expressed as percentage of the YBT amount that the pool held after all deposits).
    // For example - if after all 3 deposits in this test case, the YBT balance of the Tempus Pool was 100 and
    //        `MAX_ALLOWED_YBT_DUST_PRECENTAGE` is set to `0.000001` (0.0001%), the maximum remaning YBT balance
    //        of the pool after all users redeem should be no more than 0.0001 (0.0001% of 100).
    const MAX_ALLOWED_YBT_DUST_PRECENTAGE = 1e-6; // 0.0001% error
    const { signers: { usdcHolder, signer1, signer2 }, contracts: { usdc, rsptUsdc, rariFundManager, rariFundPriceConsumer, tempusPool }} = await setupWithRariWithdrawalFee(rariFee);
    
    expect(+await rsptUsdc.balanceOf(signer1)).to.equal(0);
    expect(+await rsptUsdc.balanceOf(signer2)).to.equal(0);
    
    const depositAmount: number = 100;
    
    await usdc.approve(signer1, tempusPool.controller.address, depositAmount);
    await usdc.approve(signer2, tempusPool.controller.address, "1000000000.0");
    
    await tempusPool.controller.depositBacking(signer2, tempusPool, "1234.56789"); // deposit some BT to the pool before 
    
    /// send directly to the Rari Fund Controller to emulate yield accumulation (which increases the interest rate).
    /// accrue some interest so that the pool interest rate increases from the initial
    await usdc.transfer(usdcHolder, (await rariFundManager.rariFundController()), "1204200.696969");  
    
    await tempusPool.controller.depositBacking(signer1, tempusPool, depositAmount); // deposit some BT to the pool before 
    
    /// send directly to the Rari Fund Controller to emulate yield accumulation (which increases the interest rate).
    /// accrue some interest so that the pool interest rate increases from the initial
    await usdc.transfer(usdcHolder, (await rariFundManager.rariFundController()), "420420.696969");  
    
    await tempusPool.controller.depositBacking(signer2, tempusPool, "1234.56789"); // deposit some BT to the pool before 
    
    /// send directly to the Rari Fund Controller to emulate yield accumulation (which increases the interest rate)
    await usdc.transfer(usdcHolder, (await rariFundManager.rariFundController()), "4204200.696969"); 
    
    const tempusPoolYbtBalancePreRedeems = await rsptUsdc.balanceOf(tempusPool.address);
    const yieldShareBalanceSigner1 = await tempusPool.yieldShare.balanceOf(signer1);
    const yieldShareBalanceSigner2 = await tempusPool.yieldShare.balanceOf(signer2);
    
    await tempusPool.controller.redeemToBacking(signer1, tempusPool, yieldShareBalanceSigner1, yieldShareBalanceSigner1, signer1.address);
    
    await tempusPool.controller.redeemToBacking(signer2, tempusPool, yieldShareBalanceSigner2, yieldShareBalanceSigner2, signer1.address);
    
    const totalSupply = await tempusPool.yieldShare.totalSupply();
    const tempusPoolYbtBalancePostRedeems = await rsptUsdc.balanceOf(tempusPool.address);
    const ybtDustRemainingPrecentage = new Decimal(tempusPoolYbtBalancePostRedeems.toString()).div(new Decimal(tempusPoolYbtBalancePreRedeems.toString()))
    
    expect(Number(totalSupply)).equals(0);
    expect(ybtDustRemainingPrecentage.toNumber()).is.lessThanOrEqual(MAX_ALLOWED_YBT_DUST_PRECENTAGE)
  }
});
