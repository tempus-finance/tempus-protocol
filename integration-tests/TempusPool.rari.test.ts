import { expect } from "chai";
import { ethers, deployments } from 'hardhat';
import { describeForSinglePool } from "../test/pool-utils/MultiPoolTestSuite";
import { blockTimestamp } from '@tempus-sdk/utils/Utils';
import { generateTempusSharesNames, PoolType, TempusPool } from "@tempus-sdk/tempus/TempusPool";
import { TempusController } from "@tempus-sdk/tempus/TempusController";
import { ERC20 } from "@tempus-sdk/utils/ERC20";
import { Decimal, decimal } from "@tempus-sdk/utils/Decimal";
import { toWei, Numberish, bn } from "@tempus-sdk/utils/DecimalUtils";
import { Balances, getAccounts, getNamedSigners } from "./IntegrationUtils";

const setupWithRariWithdrawalFee = async (rariFee:Decimal) => await deployments.createFixture(async () => {
  await deployments.fixture(undefined, {
    keepExistingDeployments: true, // global option to test network like that
  });
  
  const { owner, signer1, signer2 } = await getAccounts();
  const [ usdcHolder, rariFundManagerOwner ] = await getNamedSigners([
    'usdcHolder', 'rariFundManagerOwner'
  ]);

  const usdc = new ERC20("ERC20FixedSupply", 6, (await ethers.getContract('Usdc')));
  const rsptUsdc = new ERC20("ERC20FixedSupply", 18, (await ethers.getContract('rsptUSDC')));
  
  const rariFundManager = await ethers.getContract("rariUsdcFundManager");
  const rariFundPriceConsumer = await ethers.getContract("rariFundPriceConsumer");
  const rariFundController:string = await rariFundManager.rariFundController();

  if (rariFee.valueOf() > 0) {
    await owner.sendTransaction({ from: owner.address, to: rariFundManagerOwner.address, value: toWei(3) });
    // Set Rari's Withdrawal Fee
    await rariFundManager.connect(rariFundManagerOwner).setWithdrawalFeeRate(rariFee.toBigNumber());
  }
  
  const maturityTime = await blockTimestamp() + (60 * 60 * 24 * 30 * 3); // maturity is in 3 months
  const names = generateTempusSharesNames("USDC Rari Stable Pool Token", "RSPT", maturityTime);
  const yieldEst = 0.1;
  const controller: TempusController = await TempusController.deploy(owner);
  const tempusPool = await TempusPool.deployRari(
    owner, usdc, rsptUsdc, rariFundManager.address, controller, maturityTime, yieldEst, names
  );
  
  await usdc.transfer(usdcHolder, signer1, 10000);
  await usdc.transfer(usdcHolder, signer2, 10000);
  return {
    contracts: { rariFundManager, rariFundPriceConsumer, rariFundController, tempusPool, usdc, rsptUsdc },
    signers: { usdcHolder, signer1, signer2 }
  };
})();

describeForSinglePool('TempusPool', PoolType.Rari, 'USDC', () => {

  const usd = (amount:Numberish): Decimal => decimal(amount, 6);

  describe('Verifies that depositing directly to Rari accrues equal interest compared to depositing via TempusPool', async () => {
    it("0% Rari Withdrawal Fee", async () => {
      await testInterestDirectlyToProtocolMatchesViaTempus(decimal(0));
    });
    it("6% Rari Withdrawal Fee", async () => {
      await testInterestDirectlyToProtocolMatchesViaTempus(decimal('0.06', 18));
    });
  });

  describe('Verifies that multiple deposits (from several users) followed by complete redemption of all funds empties the pool of the entire YBT balance', async () => {
    it("0% Rari Withdrawal Fee", async () => {
      await testMultipleDepositsFollowedByCompletePoolWithdrawalsEmptiesPoolFromYbt(decimal(0));
    });
    it("6% Rari Withdrawal Fee", async () => {
      await testMultipleDepositsFollowedByCompletePoolWithdrawalsEmptiesPoolFromYbt(decimal('0.06', 18));
    });
  });

  async function testInterestDirectlyToProtocolMatchesViaTempus(rariFee:Decimal) {
    // The maximum discrepancy to allow between accrued interest from depositing directly to Rari
    //   vs depositing to Rari via TempusPool
    const MAX_ALLOWED_INTEREST_DELTA_ERROR = 1e-6; // 0.0001% error
    const {
      signers: { usdcHolder, signer1, signer2 },
      contracts: { usdc, rsptUsdc, rariFundManager, rariFundPriceConsumer, rariFundController, tempusPool }
    } = await setupWithRariWithdrawalFee(rariFee);

    expect(+await rsptUsdc.balanceOf(signer1)).to.equal(0);
    expect(+await rsptUsdc.balanceOf(signer2)).to.equal(0);

    const depositAmount = 100;
    await usdc.approve(signer1, tempusPool.controller, depositAmount);
    await usdc.approve(signer2, rariFundManager, depositAmount);
    await usdc.approve(signer2, tempusPool.controller, "1234.56789");
    await tempusPool.controller.depositBacking(signer2, tempusPool, "1234.56789"); // deposit some BT to the pool before

    /// send directly to the Rari Fund Controller to emulate yield accumulation (which increases the interest rate).
    /// accrue some interest so that the pool interest rate increases from the initial
    await usdc.transfer(usdcHolder, rariFundController, "1204200.696969");

    const preBalances = await Balances.getBalances(usdc, signer1, signer2);

    await tempusPool.controller.depositBacking(signer1, tempusPool, depositAmount); // deposit some BT to the pool before 
    await rariFundManager.connect(signer2).deposit("USDC", bn(usd(depositAmount))); // deposit directly to Rari

    /// send directly to the Rari Fund Controller to emulate yield accumulation (which increases the interest rate)
    await usdc.transfer(usdcHolder, rariFundController, "4204200.696969");

    /// max withdrawal amount calculation is based the RariSDK implementation 
    ///https://github.com/Rari-Capital/RariSDK/blob/d6293e09c36a4ac6914725f5a5528a9c1e7cb178/src/Vaults/pools/stable.ts#L1775
    // NOTE: usdcPriceInUsd is always 1.0
    const usdcPriceInUsd = decimal((await rariFundPriceConsumer.getCurrencyPricesInUsd())[1]); /// USDC is index 1, and in 1e18
    const usdValue = decimal(await rariFundManager.callStatic.balanceOf(signer2.address)); // 1e18 decimal
    const withdrawAmount = usd(usdValue.div(usdcPriceInUsd)); // apply USDC-USD rate

    const signer1yields = await tempusPool.yieldShare.balanceOf(signer1);
    await rariFundManager.connect(signer2).withdraw("USDC", bn(withdrawAmount)); // withdraw directly from Rari 
    await tempusPool.controller.redeemToBacking(signer1, tempusPool, signer1yields, signer1yields, signer1);

    const error = await preBalances.getInterestDeltaError();
    expect(+error).to.be.lessThanOrEqual(MAX_ALLOWED_INTEREST_DELTA_ERROR, `error is too high - ${error}`);
  }

  async function testMultipleDepositsFollowedByCompletePoolWithdrawalsEmptiesPoolFromYbt(rariFee:Decimal) {
    // Defines the maximum amount of TempusPool YBT balance the is considered "dust"
    //        (expressed as percentage of the YBT amount that the pool held after all deposits).
    // For example - if after all 3 deposits in this test case, the YBT balance of the Tempus Pool was 100 and
    //        `MAX_ALLOWED_YBT_DUST_PRECENTAGE` is set to `0.000001` (0.0001%), the maximum remaning YBT balance
    //        of the pool after all users redeem should be no more than 0.0001 (0.0001% of 100).
    const MAX_ALLOWED_YBT_DUST_PRECENTAGE = 1e-6; // 0.0001% error
    const { 
      signers: { usdcHolder, signer1, signer2 },
      contracts: { usdc, rsptUsdc, rariFundController, tempusPool }
    } = await setupWithRariWithdrawalFee(rariFee);

    expect(+await rsptUsdc.balanceOf(signer1)).to.equal(0);
    expect(+await rsptUsdc.balanceOf(signer2)).to.equal(0);

    const depositAmount = 100;
    await usdc.approve(signer1, tempusPool.controller, depositAmount);
    await usdc.approve(signer2, tempusPool.controller, "1000000000.0");
    await tempusPool.controller.depositBacking(signer2, tempusPool, "1234.56789"); // deposit some BT to the pool before 
    /// send directly to the Rari Fund Controller to emulate yield accumulation (which increases the interest rate).
    /// accrue some interest so that the pool interest rate increases from the initial
    await usdc.transfer(usdcHolder, rariFundController, "1204200.696969");  

    await tempusPool.controller.depositBacking(signer1, tempusPool, depositAmount); // deposit some BT to the pool before 
    /// send directly to the Rari Fund Controller to emulate yield accumulation (which increases the interest rate).
    /// accrue some interest so that the pool interest rate increases from the initial
    await usdc.transfer(usdcHolder, rariFundController, "420420.696969");  

    await tempusPool.controller.depositBacking(signer2, tempusPool, "1234.56789"); // deposit some BT to the pool before 
    /// send directly to the Rari Fund Controller to emulate yield accumulation (which increases the interest rate)
    await usdc.transfer(usdcHolder, rariFundController, "4204200.696969"); 

    const tempusPoolYbtBalancePreRedeems = await rsptUsdc.balanceOf(tempusPool);
    const signer1yields = await tempusPool.yieldShare.balanceOf(signer1);
    const signer2yields = await tempusPool.yieldShare.balanceOf(signer2);
    await tempusPool.controller.redeemToBacking(signer1, tempusPool, signer1yields, signer1yields, signer1);
    await tempusPool.controller.redeemToBacking(signer2, tempusPool, signer2yields, signer2yields, signer2);
    expect(+await tempusPool.yieldShare.totalSupply()).equals(0);

    const ybtDustRemainingPrecentage = (await rsptUsdc.balanceOf(tempusPool)).div(tempusPoolYbtBalancePreRedeems);
    expect(+ybtDustRemainingPrecentage).is.lessThanOrEqual(MAX_ALLOWED_YBT_DUST_PRECENTAGE)
  }
});
