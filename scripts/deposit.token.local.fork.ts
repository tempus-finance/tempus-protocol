import { ethers, network } from 'hardhat';
import { ERC20 } from '../test/utils/ERC20';
import { promptAddress, promptNumber, promptSelect } from './utils';

async function depositToken() {
    const tokenMap = new Map<string, ERC20>();
    tokenMap.set('DAI', new ERC20("ERC20", 18, (await ethers.getContract('Dai'))));
    tokenMap.set('USDC', new ERC20('ERC20FixedSupply', 6, (await ethers.getContract('Usdc'))));

    const holdersMap = new Map<string, string>();
    holdersMap.set('DAI', '0xE78388b4CE79068e89Bf8aA7f218eF6b9AB0e9d0');
    holdersMap.set('USDC', '0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503');

    const addressToDepositTo = await promptAddress('Enter address to deposit to:');
    const tokenToDeposit = await promptSelect('Select token you want to deposit:', ['DAI', 'USDC']);
    const depositAmount = await promptNumber('Enter deposit amount:', 500, 1, 10000);

    await sendTransaction(depositAmount, holdersMap.get(tokenToDeposit), addressToDepositTo, tokenMap.get(tokenToDeposit));
    console.log(`Deposited ${depositAmount} ${tokenToDeposit} to ${addressToDepositTo} address`);
}
depositToken();

async function sendTransaction(amount: number, from: string, to: string, token: ERC20) {
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
