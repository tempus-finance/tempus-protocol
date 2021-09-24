import { ethers, network } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';
import { ERC20 } from '../test/utils/ERC20';
import { PoolType, TempusPool } from '../test/utils/TempusPool';
import { TempusController } from '../test/utils/TempusController';
import { PoolShare } from '../test/utils/PoolShare';
import { TempusAMM, TempusAMMJoinKind } from '../test/utils/TempusAMM';
import depositConfig from '../deposit.local.config';
import { DeployedPoolInfo } from './deploy.local.fork';
import { Contract } from '@ethersproject/contracts';

class DepositLocalForked {
  private owner: SignerWithAddress;
  private controller: TempusController;
  private vault: Contract;

  public async deploy() {
    this.owner = (await ethers.getSigners())[0];

    const tokenMap = new Map<string, ERC20>();
    tokenMap.set('aDai', new ERC20("ERC20", (await ethers.getContract('aToken_Dai'))));
    tokenMap.set('cDai', new ERC20("ERC20", (await ethers.getContract('cToken_Dai'))));
    tokenMap.set('stETH', new ERC20("ERC20", (await ethers.getContract('Lido'))));
    tokenMap.set('DAI', new ERC20("ERC20", (await ethers.getContract('Dai'))));
  
    this.vault = await ethers.getContractAt('Vault', depositConfig.addresses.vault);
    
    const tempusControllerContract = await ethers.getContractAt('TempusController', depositConfig.addresses.tempusController);
    this.controller = new TempusController('TempusController', tempusControllerContract);

    await this.sendTransaction(100000000, depositConfig.holders.DAI, this.owner.address, tokenMap.get('DAI'));
    console.log('Sent 100000000 DAI to owner address');
    await this.sendTransaction(10000, depositConfig.holders.aDAI, this.owner.address, tokenMap.get('aDai'));
    console.log('Sent 10000 aDAI to owner address');
    await this.sendTransaction(10000, depositConfig.holders.cDAI, this.owner.address, tokenMap.get('cDai'));
    console.log('Sent 10000 cDAI to owner address');
    await this.sendTransaction(250000, depositConfig.holders.stETH, this.owner.address, tokenMap.get('stETH'));
    console.log('Sent 250000 stETH to owner address');

    for (let i = 0; i < depositConfig.addresses.tempusPools.length; i++) {
      const poolDepositInfo = depositConfig.addresses.tempusPools[i] as DeployedPoolInfo;

      console.log(`Depositing into ${poolDepositInfo.protocol} ${poolDepositInfo.backingToken}/${poolDepositInfo.yieldBearingToken} Pool...`);

      await this.depositIntoPool(
        poolDepositInfo.protocol,
        tokenMap.get(poolDepositInfo.yieldBearingToken),
        tokenMap.get(poolDepositInfo.backingToken),
        poolDepositInfo.protocol === PoolType.Lido ? false : true,
        poolDepositInfo
      );
    }
  }

  private async depositIntoPool(poolType: PoolType, ybt: ERC20, bt: ERC20, depositBacking: boolean, poolDepositConfig: DeployedPoolInfo) {
    const principalShareToken = await ethers.getContractAt('PrincipalShare', poolDepositConfig.principalShare);
    const yieldShareToken = await ethers.getContractAt('YieldShare', poolDepositConfig.yieldShare);
    const poolSharePrincipal = new PoolShare('PoolShare', principalShareToken);
    const poolShareYield = new PoolShare('PoolShare', yieldShareToken);

    const tempusPoolContract = await ethers.getContractAt('TempusPool', poolDepositConfig.address);
    const tempusPool = new TempusPool(poolType, tempusPoolContract, this.controller, ybt, poolSharePrincipal, poolShareYield);

    const tempusPoolAMMContract = await ethers.getContractAt('TempusAMM', poolDepositConfig.amm);
    const tempusPoolAMM = new TempusAMM(tempusPoolAMMContract, this.vault, tempusPool);

    // Deposit
    if (depositBacking) {
      await bt.approve(this.owner, tempusPool.controller.address, 10000000);
      await tempusPool.controller.depositBacking(this.owner, tempusPool, 10000000, this.owner);
    }
    else {
      await tempusPool.controller.depositYieldBearing(this.owner, tempusPool, 100000, this.owner);
    }

    // Provide liquidity
    if (depositBacking) {
        await tempusPoolAMM.provideLiquidity(this.owner, (9000000 * poolDepositConfig.estimatedYield), 9000000, TempusAMMJoinKind.INIT);
    }
    else {
        await tempusPoolAMM.provideLiquidity(this.owner, (90000 * poolDepositConfig.estimatedYield), 90000, TempusAMMJoinKind.INIT);
    }

    // Make a swap
    await tempusPoolAMM.swapGivenIn(this.owner, principalShareToken.address, yieldShareToken.address, 25);
  }

  private async sendTransaction(amount: number, from: string, to: string, token: ERC20) {
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

const depositLocalForked = new DepositLocalForked();
depositLocalForked.deploy();
