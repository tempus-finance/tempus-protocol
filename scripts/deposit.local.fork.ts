// External libraries
import { ethers, network, getNamedAccounts } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';

// Test Utils
import { ERC20 } from '../test/utils/ERC20';
import { PoolType, TempusPool } from '../test/utils/TempusPool';
import { TempusController } from '../test/utils/TempusController';
import { PoolShare } from '../test/utils/PoolShare';
import { TempusAMM, TempusAMMJoinKind } from '../test/utils/TempusAMM';

// Config
import depositConfig from '../deposit.local.config';

class DeployLocalForked {
  static async deploy() {
    const owner = (await ethers.getSigners())[0];

    const aDaiToken = new ERC20("ERC20", (await ethers.getContract('aToken_Dai')));
    const stEthToken = new ERC20("ILido", (await ethers.getContract('Lido')));
    const daiToken = new ERC20("ERC20", (await ethers.getContract('Dai')));

    const vaultContract = await ethers.getContractAt('Vault', depositConfig.addresses.vault);

    const tempusControllerContract = await ethers.getContractAt('TempusController', depositConfig.addresses.tempusController);
    const tempusController = new TempusController('TempusController', tempusControllerContract);

    // Connect to Aave Tempus Pool contracts
    const principalShareTokenAave = await ethers.getContractAt('PrincipalShare', depositConfig.addresses.tempusPools[0].principalShare);
    const yieldShareTokenAave = await ethers.getContractAt('YieldShare', depositConfig.addresses.tempusPools[0].yieldShare);
    const poolSharePrincipalAave = new PoolShare('PoolShare', principalShareTokenAave);
    const poolShareYieldAave = new PoolShare('PoolShare', yieldShareTokenAave);

    const tempusPoolAaveContract = await ethers.getContractAt('TempusPool', depositConfig.addresses.tempusPools[0].address);
    const tempusPoolAave = new TempusPool(PoolType.Aave, tempusPoolAaveContract, tempusController, aDaiToken, poolSharePrincipalAave, poolShareYieldAave);

    const tempusPoolAMMAaveContract = await ethers.getContractAt('TempusAMM', depositConfig.addresses.tempusPools[0].amm);
    const tempusPoolAMMAave = new TempusAMM(tempusPoolAMMAaveContract, vaultContract, tempusPoolAave);
    ////

    // Connect to Lido Tempus Pool contracts
    const principalShareTokenLido = await ethers.getContractAt('PrincipalShare', depositConfig.addresses.tempusPools[1].principalShare);
    const yieldShareTokenLido = await ethers.getContractAt('YieldShare', depositConfig.addresses.tempusPools[1].yieldShare);
    const poolSharePrincipalLido = new PoolShare('PoolShare', principalShareTokenLido);
    const poolShareYieldLido = new PoolShare('PoolShare', yieldShareTokenLido);

    const tempusPoolLidoContract = await ethers.getContractAt('TempusPool', depositConfig.addresses.tempusPools[1].address);
    const tempusPoolLido = new TempusPool(PoolType.Aave, tempusPoolLidoContract, tempusController, stEthToken, poolSharePrincipalLido, poolShareYieldLido);

    const tempusPoolAMMLidoContract = await ethers.getContractAt('TempusAMM', depositConfig.addresses.tempusPools[1].amm);
    const tempusPoolAMMLido = new TempusAMM(tempusPoolAMMLidoContract, vaultContract, tempusPoolLido);
    ////

    const { aDaiHolder } = await getNamedAccounts();

    // Send tokens required for Aave pool to owner user
    await this.sendTransaction(10000, depositConfig.holders.DAI, owner.address, daiToken);
    console.log('Sent 10000 DAI to owner address');
    await this.sendTransaction(10000, aDaiHolder, owner.address, aDaiToken);
    console.log('Sent 10000 aDAI to owner address');

    // Send tokens required for Lido pool to owner user
    await this.sendTransaction(10000, depositConfig.holders.stETH, owner.address, stEthToken);
    console.log('Sent 10000 stETH to owner address');

    // Make deposits into Aave pool
    await this.makeDeposit(5000, tempusPoolAave, owner.address, aDaiToken);
    console.log('Made a deposit of 5000 aDAI tokens into Aave Pool');
    await this.provideLiquidity(tempusPoolAMMAave, owner, 1000, 1000);
    console.log('Provided 1000/1000 liquidity to Aave Pool');
    await this.makeSwapGivenIn(tempusPoolAMMAave, owner, principalShareTokenAave.address, yieldShareTokenAave.address, 100);
    console.log('Swapped 100 TPS in Aave Pool');

    // Make deposits into Lido pool
    await this.makeDeposit(2, tempusPoolLido, owner.address, stEthToken);
    console.log('Made a deposit of 2 stETH tokens into Lido Pool');
    await this.provideLiquidity(tempusPoolAMMLido, owner, 1, 1);
    console.log('Provided 1/1 liquidity to Lido Pool');
    await this.makeSwapGivenIn(tempusPoolAMMLido, owner, principalShareTokenLido.address, yieldShareTokenLido.address, 0.5);
    console.log('Swapped 0.5 TPS in Lido Pool');
  }

  static async provideLiquidity(amm: TempusAMM, owner: SignerWithAddress, principalAmount: number, yieldAmount: number, ) {
    await amm.provideLiquidity(owner, principalAmount, yieldAmount, TempusAMMJoinKind.INIT);
  }

  static async makeSwapGivenIn(amm: TempusAMM, owner: SignerWithAddress, tokenInAddress: string, tokenOutAddress: string, amount: number) {
    await amm.swapGivenIn(owner, tokenInAddress, tokenOutAddress, amount);
  }

  static async makeSwapGivenOut(amm: TempusAMM, owner: SignerWithAddress, tokenInAddress: string, tokenOutAddress: string, amount: number) {
    await amm.swapGivenOut(owner, tokenInAddress, tokenOutAddress, amount);
  }

  static async makeDeposit(amount: number, pool: TempusPool, from: string, token: ERC20) {
    const fromSigner = await ethers.getSigner(from);

    await token.approve(fromSigner, fromSigner, amount);
    await pool.controller.depositYieldBearing(fromSigner, pool, amount, fromSigner);
  }

  static async sendTransaction(amount: number, from: string, to: string, token: ERC20) {
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [from],
    });
    const fromSigner = await ethers.getSigner(from);
    
    await token.approve(fromSigner, fromSigner, amount);
    await token.transfer(fromSigner, to, amount);

    await network.provider.request({
      method: "hardhat_stopImpersonatingAccount",
      params: [from],
    });
  }
}
DeployLocalForked.deploy();
