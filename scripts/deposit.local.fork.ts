import { ethers, network } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';
import { ERC20 } from '@tempus-sdk/utils/ERC20';
import depositConfig from '../deposit.local.config';

class DepositLocalForked {
  private owner: SignerWithAddress;

  public async deploy() {
    this.owner = (await ethers.getSigners())[0];

    const tokenMap = new Map<string, ERC20>();
    tokenMap.set('aDai', new ERC20("ERC20", 18, (await ethers.getContract('aToken_Dai'))));
    tokenMap.set('cDai', new ERC20("ERC20", 8, (await ethers.getContract('cToken_Dai'))));
    tokenMap.set('stETH', new ERC20("ERC20", 18, (await ethers.getContract('Lido'))));
    tokenMap.set('DAI', new ERC20("ERC20", 18, (await ethers.getContract('Dai'))));
    tokenMap.set('USDC', new ERC20('ERC20FixedSupply', 6, (await ethers.getContract('Usdc'))));
    tokenMap.set('rsptUSDC', new ERC20('ERC20FixedSupply', 18, (await ethers.getContract('rsptUSDC'))));

    await this.sendTransaction(100000, depositConfig.holders.DAI, this.owner.address, tokenMap.get('DAI'));
    console.log('Sent 100000 DAI to owner address');
    await this.sendTransaction(100000, depositConfig.holders.USDC, this.owner.address, tokenMap.get('USDC'));
    console.log('Sent 100000 USDC to owner address');
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
