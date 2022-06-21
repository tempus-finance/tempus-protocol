import { expect } from "chai";
import { ethers, deployments } from 'hardhat';
import { describeForSinglePool } from "../test/pool-utils/MultiPoolTestSuite";
import { blockTimestamp } from '@tempus-sdk/utils/Utils';
import { generateTempusSharesNames, TempusPool, PoolType } from "@tempus-sdk/tempus/TempusPool";
import { TempusController } from "@tempus-sdk/tempus/TempusController";
import { ERC20 } from "@tempus-sdk/utils/ERC20";
import { ERC20Ether } from "@tempus-sdk/utils/ERC20Ether";
import { decimal } from "@tempus-sdk/utils/Decimal";
import { toWei } from "@tempus-sdk/utils/DecimalUtils";
import { Balances, getNamedSigners, getAccounts } from "./IntegrationUtils";

const setup = deployments.createFixture(async () => {
  await deployments.fixture(undefined, { keepExistingDeployments: true });
  
  const { owner, signer1, signer2 } = await getAccounts();

  const [ stakeWiseOracleSigner ] = await getNamedSigners(['stakeWiseOracle']);

  const eth = new ERC20Ether();
  const stakeWiseStakedEthToken = new ERC20("ERC20FixedSupply", 18, (await ethers.getContract('StakeWiseStakedEthToken')));
  const stakeWiseRewardEthToken = new ERC20("IRewardEthToken", 18, (await ethers.getContract('StakeWiseRewardEthToken')));
  const stakeWisePool = await ethers.getContract('stakeWisePool');
  
  const maturityTime = await blockTimestamp() + 60*60 * 24 * 30; // maturity is in 30 days
  const names = generateTempusSharesNames("StakeWise sETH", "sETH", maturityTime);
  const yieldEst = 0.0423;

  const controller = await TempusController.deploy(owner);
  const tempusPool = await TempusPool.deployStakeWise(
    owner, eth, stakeWiseStakedEthToken, controller, maturityTime, yieldEst, names, stakeWiseRewardEthToken
  );

  return {
    contracts: { tempusPool, stakeWiseStakedEthToken, stakeWiseRewardEthToken, stakeWisePool },
    signers: { signer1, signer2, stakeWiseOracleSigner }
  };
});

describeForSinglePool.only('TempusPool', PoolType.StakeWise, 'ETH', () => {
  it('Verifies that depositing directly to Lido accrues equal interest compared to depositing via TempusPool', async () => {
    // The maximum discrepancy to allow between accrued interest from depositing directly to Lido
    //    vs depositing to Lido via TempusPool
    const MAX_ALLOWED_INTEREST_DELTA_ERROR = 1e-18; // 0.0000000000000001% error
    const { 
      signers: { signer1, signer2, stakeWiseOracleSigner },
      contracts: { tempusPool, stakeWiseStakedEthToken, stakeWiseRewardEthToken, stakeWisePool }
    } = await setup();

    const depositAmount: number = 100;
    const initialPoolYieldBearingBalance = "12345.678901234";
    await tempusPool.controller.depositYieldBearing(signer2, tempusPool, initialPoolYieldBearingBalance, signer2); // deposit some YBT to the pool before 

    const preBalances = await Balances.getBalances(tempusPool.yieldBearing, signer1, signer2);

    await tempusPool.controller.depositYieldBearing(signer1, tempusPool, depositAmount, signer1);
    await stakeWisePool.connect(signer2).stake({ value: toWei(depositAmount) }); // deposit directly to StakeWise

    // This increases StakeWise's yield
    const currentTotalRewards = await stakeWiseRewardEthToken.contract.totalRewards();
    const newTotalRewards = currentTotalRewards.mul(1456).div(1000);
    await stakeWiseRewardEthToken.contract.connect(stakeWiseOracleSigner).updateTotalRewards(newTotalRewards);
    
    const signer1yields = await tempusPool.yieldShare.balanceOf(signer1);
    await tempusPool.controller.redeemToYieldBearing(signer1, tempusPool, signer1yields, signer1yields, signer1)

    const error = await preBalances.getInterestDeltaError();
    expect(+error).to.be.lessThanOrEqual(MAX_ALLOWED_INTEREST_DELTA_ERROR, `error is too high - ${error}`);
  });
});
