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
    const daiToken = new ERC20("ERC20", (await ethers.getContract('Dai')));

    const vaultContract = await ethers.getContractAt('Vault', depositConfig.addresses.vault);

    const tempusControllerContract = await ethers.getContractAt('TempusController', depositConfig.addresses.tempusController);
    const tempusController = new TempusController('TempusController', tempusControllerContract);

    const principalShareToken = await ethers.getContractAt('PrincipalShare', depositConfig.addresses.tempusPools[0].principalShare);
    const yieldShareToken = await ethers.getContractAt('YieldShare', depositConfig.addresses.tempusPools[0].yieldShare);
    const poolSharePrincipal = new PoolShare('PoolShare', principalShareToken);
    const poolShareYield = new PoolShare('PoolShare', yieldShareToken);

    const tempusPoolContract = await ethers.getContractAt('TempusPool', depositConfig.addresses.tempusPools[0].address);
    const tempusPool = new TempusPool(PoolType.Aave, tempusPoolContract, tempusController, aDaiToken, poolSharePrincipal, poolShareYield);

    const tempusPoolAMMContract = await ethers.getContractAt('TempusAMM', depositConfig.addresses.tempusPools[0].amm);
    const tempusPoolAMM = new TempusAMM(tempusPoolAMMContract, vaultContract, tempusPool);

    // Make deposit into pool to increase pool TVL
    const { aDaiHolder, daiHolder } = await getNamedAccounts();

    await this.sendTransaction(10000, daiHolder, owner.address, daiToken);
    await this.sendTransaction(10000, aDaiHolder, owner.address, aDaiToken);
    await this.makeDeposit(500, tempusPool, owner.address, aDaiToken);
    await this.provideLiquidity(tempusPoolAMM, owner, 250, 250);
    await this.makeSwapGivenIn(tempusPoolAMM, owner, principalShareToken.address, yieldShareToken.address, 100);
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
    try {
      const fromSigner = await ethers.getSigner(from);

      await token.approve(fromSigner, fromSigner, amount);
      await pool.controller.depositYieldBearing(fromSigner, pool, amount, fromSigner);
    }
    catch (error) {
      console.error('Failed to make a deposit!');
    }
  }

  static async sendTransaction(amount: number, from: string, to: string, token: ERC20) {
    try {
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
    catch (error) {
      console.error('Failed to send a transaction!');
    }
  }
}
DeployLocalForked.deploy();
