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
  const accounts = await getNamedAccounts();
  const daiHolder = accounts["daiHolder"];
  const usdcHolder = accounts["usdcHolder"];
  const [ account1, account2 ] = await getUnnamedAccounts();
  const daiHolderSigner = await ethers.getSigner(daiHolder);
  const usdcHolderSigner = await ethers.getSigner(usdcHolder);

  const daiBackingToken = new ERC20("ERC20FixedSupply", 18, (await ethers.getContract('Dai')));
  const cDaiYieldToken = new ERC20("ICErc20", 8, (await ethers.getContract('cToken_Dai')));

  const usdcBackingToken = new ERC20("ERC20FixedSupply", 6, (await ethers.getContract('Usdc')));
  const cUsdcYieldToken = new ERC20("ICErc20", 8, await ethers.getContract("cToken_Usdc"));
  
  const maturityTime = await blockTimestamp() + 60*60*24*5; // maturity is in 5 days
  const names = generateTempusSharesNames("cDai compound token", "cDai", maturityTime);
  const yieldEst = 0.1;
  const controller = await TempusController.deploy(owner);
  const tempusPool = await TempusPool.deployCompound(
    owner, daiBackingToken, cDaiYieldToken, controller, maturityTime, yieldEst, names
  );

  await daiBackingToken.transfer(daiHolderSigner, account1, 100000);
  await daiBackingToken.transfer(daiHolderSigner, account2, 100000);

  const namesUsdc = generateTempusSharesNames("cUsdc compound token", "cUsdc", maturityTime);
  const tempusPoolUsdc = await TempusPool.deployCompound(
    owner, usdcBackingToken, cUsdcYieldToken, controller, maturityTime, yieldEst, namesUsdc
  );

  await usdcBackingToken.connect(usdcHolderSigner).transfer((await ethers.getSigner(account1)).address, 10000000000);
  await usdcBackingToken.connect(usdcHolderSigner).transfer((await ethers.getSigner(account2)).address, 10000000000);

  return {
    contracts: {
      tempusPool,
      dai: daiBackingToken,
      cDai: cDaiYieldToken,
      tempusPoolUsdc,
      usdc: usdcBackingToken,
      cUsdc: cUsdcYieldToken
    },
    signers: {
      daiHolder: daiHolderSigner,
      signer1: await ethers.getSigner(account1),
      signer2: await ethers.getSigner(account2)
    }
  };
});

describe('TempusPool <> Compound <> USDC', function() {
  it('Verify minted shares', async () => {
    const { signers: { signer1 }, contracts: { usdc, cUsdc, tempusPoolUsdc }} = await setup();
    await usdc.approve(signer1, tempusPoolUsdc.controller.address, 100000000);
    await tempusPoolUsdc.controller.contract.connect(signer1).depositBacking(tempusPoolUsdc.address, 100000000, signer1.address);
    expect(await tempusPoolUsdc.principalShare.contract.balanceOf(signer1.address)).to.be.within(100000000 * 0.9999, 100000000 * 1.0001);
  });

  it('Verify withdrawn backing tokens', async () => {
    const { signers: { signer1 }, contracts: { usdc, cUsdc, tempusPoolUsdc }} = await setup();
    await usdc.approve(signer1, tempusPoolUsdc.controller.address, 100000000);
    const oldBalance = +await usdc.contract.balanceOf(signer1.address)
    await tempusPoolUsdc.controller.contract.connect(signer1).depositBacking(tempusPoolUsdc.address, 100000000, signer1.address);
    await tempusPoolUsdc.controller.contract.connect(signer1).redeemToBacking(
      tempusPoolUsdc.address,
      await tempusPoolUsdc.principalShare.contract.balanceOf(signer1.address),
      await tempusPoolUsdc.yieldShare.contract.balanceOf(signer1.address),
      signer1.address
    );
    expect(await usdc.contract.balanceOf(signer1.address)).to.be.within(oldBalance * 0.9999, oldBalance * 1.0001);
  });
});

describe('TempusPool <> Compound <> DAI', function () {
  it('Verifies that depositing directly to Compound accrues equal interest compared to depositing via TempusPool', async () => {
    // The maximum discrepancy to allow between accrued interest from depositing directly to Compound
    //    vs depositing to Compound via TempusPool
    const MAX_ALLOWED_INTEREST_DELTA_ERROR = 1e-6; // 0.000001% error
    const { signers: { signer1, signer2 }, contracts: { dai, cDai, tempusPool }} = await setup();
    expect(await cDai.balanceOf(signer1)).to.equal(0);
    expect(await cDai.balanceOf(signer2)).to.equal(0);
    
    
    const depositAmount: number = 100;
    await dai.approve(signer1, tempusPool.controller.address, depositAmount);
    await dai.approve(signer2, cDai.address, depositAmount);
    await dai.approve(signer2, tempusPool.controller.address, "12345.678901234");
    await tempusPool.controller.depositBacking(signer2, tempusPool, "12345.678901234"); // deposit some BT to the pool before 
    
    const btBalancePreSigner1 = await dai.balanceOf(signer1.address);
    const btBalancePreSigner2 = await dai.balanceOf(signer2.address);
    
    await evmSetAutomine(false);
    await tempusPool.controller.depositBacking(signer1, tempusPool, depositAmount); // deposit some BT to the pool before 
    await cDai.connect(signer2).mint(toWei(depositAmount)); // deposit directly to Compound
    await evmMine();
    await evmSetAutomine(true);
    
    // mine a bunch of blocks to accrue interest
    for (let i = 0; i < 10000; i++) {
      await evmMine();
    }
    
    const yieldShareBalanceSigner1 = await tempusPool.yieldShare.balanceOf(signer1);

    await evmSetAutomine(false);
    
    await tempusPool.controller.redeemToBacking(signer1, tempusPool, yieldShareBalanceSigner1, yieldShareBalanceSigner1, signer1.address);
    await cDai.connect(signer2).redeem((await cDai.contract.balanceOf(signer2.address)));
    await evmMine();
    await evmSetAutomine(true);

    const btBalancePostSigner1 = await dai.balanceOf(signer1);
    const btBalancePostSigner2 = await dai.balanceOf(signer2);
    const totalInterestSigner1 = toWei(btBalancePostSigner1).sub(toWei(btBalancePreSigner1));
    const totalInterestSigner2 = toWei(btBalancePostSigner2).sub(toWei(btBalancePreSigner2));
    
    const error = new Decimal(1).sub(new Decimal(fromWei(totalInterestSigner2).toString())
      .div(fromWei(totalInterestSigner1).toString())).abs()
    
    expect(error.lessThanOrEqualTo(MAX_ALLOWED_INTEREST_DELTA_ERROR)).is.true;
  });
});
