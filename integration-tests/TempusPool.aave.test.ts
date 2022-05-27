import { expect } from "chai";
import { ethers, deployments } from 'hardhat';
import { describeForSinglePool } from "../test/pool-utils/MultiPoolTestSuite";
import { blockTimestamp, evmMineInSingleBlock, increaseTime } from '@tempus-sdk/utils/Utils';
import { generateTempusSharesNames, TempusPool, PoolType } from "@tempus-sdk/tempus/TempusPool";
import { TempusController } from "@tempus-sdk/tempus/TempusController";
import { ERC20 } from "@tempus-sdk/utils/ERC20";
import { toWei } from "@tempus-sdk/utils/DecimalUtils";
import { Balances, getAccounts } from "./IntegrationUtils";

const setup = deployments.createFixture(async () => {
  await deployments.fixture(undefined, {
    keepExistingDeployments: true, // global option to test network like that
  });

  const { owner, holder, signer1, signer2 } = await getAccounts("daiHolder");
  
  const dai = new ERC20("ERC20FixedSupply", 18, (await ethers.getContract('Dai')));
  const aDai = new ERC20("IAToken", 18, (await ethers.getContract('aToken_Dai')));
  const aave = await ethers.getContract('LendingPool'); 

  const maturityTime = await blockTimestamp() + 60*60; // maturity is in 1hr
  const names = generateTempusSharesNames("aDai aave token", "aDai", maturityTime);
  const yieldEst = 0.1;

  const controller = await TempusController.deploy(owner);
  const tempusPool = await TempusPool.deployAave(
    owner, dai, aDai, controller, maturityTime, yieldEst, names
  );
  
  await dai.transfer(holder, signer1, 100000);
  await dai.transfer(holder, signer2, 100000);
  return { contracts: { aave, tempusPool, dai, aDai }, signers: { signer1, signer2 } };
});

describeForSinglePool('TempusPool', PoolType.Aave, 'DAI', function () {
  it('Verifies that depositing directly to Aave accrues equal interest compared to depositing via TempusPool', async () => {
    // The maximum discrepancy to allow between accrued interest from depositing directly to Aave
    //   vs depositing to Aave via TempusPool
    const MAX_ALLOWED_INTEREST_DELTA_ERROR = 1e-16; // 0.00000000000001% error
    const { signers: { signer1, signer2 }, contracts: { dai, aDai, aave, tempusPool }} = await setup();
    expect(+await aDai.balanceOf(signer1)).to.equal(0);
    expect(+await aDai.balanceOf(signer2)).to.equal(0);

    const depositAmount: number = 100;
    await dai.approve(signer1, tempusPool.controller, depositAmount);
    await dai.approve(signer2, aave, depositAmount);
    await dai.approve(signer2, tempusPool.controller, "12345.678901234");
    await tempusPool.controller.depositBacking(signer2, tempusPool, "12345.678901234"); // deposit some BT to the pool before 

    const preBalances = await Balances.getBalances(dai, signer1, signer2);

    await evmMineInSingleBlock(async () =>
    {
      await tempusPool.controller.depositBacking(signer1, tempusPool, depositAmount); // deposit some BT to the pool before 
      await aave.connect(signer2).deposit(dai.address, toWei(depositAmount), signer2.address, 0); // deposit directly to Aave
    });
    await increaseTime(60 * 60 * 24 * 30 * 12); // Increase time by 1 year

    await evmMineInSingleBlock(async () =>
    {
      const signer1yields = await tempusPool.yieldShare.balanceOf(signer1);
      await tempusPool.controller.redeemToBacking(signer1, tempusPool, signer1yields, signer1yields, signer1)
      await aave.connect(signer2).withdraw(dai.address, ethers.constants.MaxUint256, signer2.address); // deposit directly to Aave
    });

    const error = await preBalances.getInterestDeltaError();
    expect(+error).to.be.lessThanOrEqual(MAX_ALLOWED_INTEREST_DELTA_ERROR, `error is too high - ${error}`);
  });
});
