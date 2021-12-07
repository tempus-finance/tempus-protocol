import { expect } from "chai";
import {
  ethers,
  deployments,
  getNamedAccounts,
  getUnnamedAccounts
} from 'hardhat';
import { blockTimestamp, evmMine, evmSetAutomine, increaseTime } from '../test/utils/Utils';
import { generateTempusSharesNames, TempusPool } from "../test/utils/TempusPool";
import { ERC20 } from "../test/utils/ERC20";
import { TempusController } from "../test/utils/TempusController";
import { fromWei, toWei } from "../test/utils/Decimal";
import Decimal from "decimal.js";

const setup = deployments.createFixture(async () => {
  await deployments.fixture(undefined, {
    keepExistingDeployments: true, // global option to test network like that
  });

  const owner = (await ethers.getSigners())[0];
  const { daiHolder, aDaiHolder } = await getNamedAccounts();
  const [ account1, account2 ] = await getUnnamedAccounts();
  const daiHolderSigner = await ethers.getSigner(daiHolder);

  const daiBackingToken = new ERC20("ERC20FixedSupply", 18, (await ethers.getContract('Dai')));
  const aDaiYieldToken = new ERC20("IAToken", 18, (await ethers.getContract('aToken_Dai')));
  
  const aaveLendingPool = await ethers.getContract('LendingPool'); 
  
  const maturityTime = await blockTimestamp() + 60*60; // maturity is in 1hr
  const names = generateTempusSharesNames("aDai aave token", "aDai", maturityTime);
  const yieldEst = 0.1;

  const controller = await TempusController.deploy(owner);
  const tempusPool = await TempusPool.deployAave(
    owner, daiBackingToken, aDaiYieldToken, controller, maturityTime, yieldEst, names
  );
  
  await daiBackingToken.transfer(daiHolderSigner, account1, 100000);
  await daiBackingToken.transfer(daiHolderSigner, account2, 100000);

  return {
    contracts: {
      aaveLendingPool,
      tempusPool,
      dai: daiBackingToken,
      aDai: aDaiYieldToken
    },
    signers: {
      daiHolder: daiHolderSigner,
      aDaiHolder: await ethers.getSigner(aDaiHolder),
      signer1: await ethers.getSigner(account1),
      signer2: await ethers.getSigner(account2)
    }
  };
});

describe('TempusPool <> Aave', function () {
  it('Verifies that depositing directly to Aave accrues equal interest compared to depositing via TempusPool', async () => {
    // The maximum discrepancy to allow between accrued interest from depositing directly to Aave
    //   vs depositing to Aave via TempusPool
    const MAX_ALLOWED_INTEREST_DELTA_ERROR = 1e-16; // 0.00000000000001% error
    const { signers: { daiHolder, signer1, signer2 }, contracts: { dai, aDai, aaveLendingPool, tempusPool }} = await setup();
    expect(+await aDai.balanceOf(signer1)).to.equal(0);
    expect(+await aDai.balanceOf(signer2)).to.equal(0);
    
    
    const depositAmount: number = 100;
    await dai.approve(signer1, tempusPool.controller.address, depositAmount);
    await dai.approve(signer2, aaveLendingPool.address, depositAmount);
    await dai.approve(signer2, tempusPool.controller.address, "12345.678901234");
    await tempusPool.controller.depositBacking(signer2, tempusPool, "12345.678901234"); // deposit some BT to the pool before 
    
    const btBalancePreSigner1 = await dai.balanceOf(signer1.address);
    const btBalancePreSigner2 = await dai.balanceOf(signer2.address);
    
    await evmSetAutomine(false);
    await tempusPool.controller.depositBacking(signer1, tempusPool, depositAmount); // deposit some BT to the pool before 
    await aaveLendingPool.connect(signer2).deposit(dai.address, toWei(depositAmount), signer2.address, 0); // deposit directly to Aave
    await evmMine();
    await evmSetAutomine(true);
    await increaseTime(60 * 60 * 24 * 30 * 12); // Increase time by 1 year
    
    const yieldShareBalanceSigner1 = await tempusPool.yieldShare.balanceOf(signer1);

    await evmSetAutomine(false);
    
    await tempusPool.controller.redeemToBacking(signer1, tempusPool, yieldShareBalanceSigner1, yieldShareBalanceSigner1, signer1.address)
    await aaveLendingPool.connect(signer2).withdraw(dai.address, ethers.constants.MaxUint256, signer2.address); // deposit directly to Aave
    await evmMine();
    await evmSetAutomine(true);

    const btBalancePostSigner1 = await dai.balanceOf(signer1);
    const btBalancePostSigner2 = await dai.balanceOf(signer2);
    const totalInterestSigner1 = toWei(btBalancePostSigner1).sub(toWei(btBalancePreSigner1));
    const totalInterestSigner2 = toWei(btBalancePostSigner2).sub(toWei(btBalancePreSigner2));
    
    const error = new Decimal(1).sub(new Decimal(fromWei(totalInterestSigner2).toString())
      .div(fromWei(totalInterestSigner1).toString())).abs()
    
    expect(error.lessThanOrEqualTo(MAX_ALLOWED_INTEREST_DELTA_ERROR), `error is too high - ${error}`).to.be.true;
  });
});
