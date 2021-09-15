// External libraries
import { ethers, network, getNamedAccounts } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';

// Test Utils
import { SignerOrAddress } from '../test/utils/ContractBase';
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
    const cDaiToken = new ERC20("ERC20", (await ethers.getContract('cToken_Dai')));
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

    // Connect to Compound Tempus Pool contracts
    const principalShareTokenCompound = await ethers.getContractAt('PrincipalShare', depositConfig.addresses.tempusPools[1].principalShare);
    const yieldShareTokenCompound = await ethers.getContractAt('YieldShare', depositConfig.addresses.tempusPools[1].yieldShare);
    const poolSharePrincipalCompound = new PoolShare('PoolShare', principalShareTokenCompound);
    const poolShareYieldCompound = new PoolShare('PoolShare', yieldShareTokenCompound);

    const tempusPoolCompoundContract = await ethers.getContractAt('TempusPool', depositConfig.addresses.tempusPools[1].address);
    const tempusPoolCompound = new TempusPool(PoolType.Compound, tempusPoolCompoundContract, tempusController, cDaiToken, poolSharePrincipalCompound, poolShareYieldCompound);

    const tempusPoolAMMCompoundContract = await ethers.getContractAt('TempusAMM', depositConfig.addresses.tempusPools[1].amm);
    const tempusPoolAMMCompound = new TempusAMM(tempusPoolAMMCompoundContract, vaultContract, tempusPoolCompound);
    ////

    // Connect to Lido Tempus Pool contracts
    const principalShareTokenLido = await ethers.getContractAt('PrincipalShare', depositConfig.addresses.tempusPools[2].principalShare);
    const yieldShareTokenLido = await ethers.getContractAt('YieldShare', depositConfig.addresses.tempusPools[2].yieldShare);
    const poolSharePrincipalLido = new PoolShare('PoolShare', principalShareTokenLido);
    const poolShareYieldLido = new PoolShare('PoolShare', yieldShareTokenLido);

    const tempusPoolLidoContract = await ethers.getContractAt('TempusPool', depositConfig.addresses.tempusPools[2].address);
    const tempusPoolLido = new TempusPool(PoolType.Lido, tempusPoolLidoContract, tempusController, stEthToken, poolSharePrincipalLido, poolShareYieldLido);

    const tempusPoolAMMLidoContract = await ethers.getContractAt('TempusAMM', depositConfig.addresses.tempusPools[2].amm);
    const tempusPoolAMMLido = new TempusAMM(tempusPoolAMMLidoContract, vaultContract, tempusPoolLido);
    ////

    /*
    // Send tokens required for Aave pool to owner user
    await this.sendTransaction(10000, depositConfig.holders.DAI, owner.address, daiToken);
    console.log('Sent 10000 DAI to owner address');
*/
    // Send tokens required for Compound pool to owner user
    await this.sendTransaction(10000, depositConfig.holders.DAI, owner.address, daiToken);
    console.log('Sent 10000 DAI to owner address');

    // Send tokens required for Lido pool to owner user
    await this.sendTransaction(10000, depositConfig.holders.stETH, owner.address, stEthToken);
    console.log('Sent 10000 stETH to owner address');

    // Make deposits into Aave pool
    await daiToken.approve(owner, tempusPoolCompound.controller.address, 10000);
    await tempusPoolAave.controller.depositBacking(owner, tempusPoolAave, 10000, owner);
    console.log('Made a deposit of 10000 DAI tokens into Aave Pool');
    await tempusPoolAMMAave.provideLiquidity(owner, 1000, 1000, TempusAMMJoinKind.INIT);
    console.log('Provided 1000/1000 liquidity to Aave Pool');
    await tempusPoolAMMAave.swapGivenIn(owner, principalShareTokenAave.address, yieldShareTokenAave.address, 100);
    console.log('Swapped 100 TPS in Aave Pool');

    // Make deposits into Lido pool
    await tempusPoolLido.controller.depositYieldBearing(owner, tempusPoolLido, 2, owner);
    console.log('Made a deposit of 2 stETH tokens into Lido Pool');
    await tempusPoolAMMLido.provideLiquidity(owner, 1, 1, TempusAMMJoinKind.INIT);
    console.log('Provided 1/1 liquidity to Lido Pool');
    await tempusPoolAMMLido.swapGivenIn(owner, principalShareTokenLido.address, yieldShareTokenLido.address, 0.5);
    console.log('Swapped 0.5 TPS in Lido Pool');

    // Make deposits into Compound Pool
    await daiToken.approve(owner, tempusPoolCompound.controller.address, 10000);
    await tempusPoolCompound.controller.depositBacking(owner, tempusPoolCompound, 10000, owner);
    console.log('Made a deposit of 10000 DAI tokens into Compound Pool');
    await tempusPoolAMMCompound.provideLiquidity(owner, 1000, 1000, TempusAMMJoinKind.INIT);
    console.log('Provided 1000/1000 liquidity to Compound Pool');
    await tempusPoolAMMCompound.swapGivenIn(owner, principalShareTokenCompound.address, yieldShareTokenCompound.address, 100);
    console.log('Swapped 100 TPS in Compound Pool');
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
