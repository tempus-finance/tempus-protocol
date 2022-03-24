import { ethers, network } from 'hardhat';

const tempusControllerAddress = '0x039557b8f8f53d863f534C4dFF01d8A3467d26A0';
const userWalletAddress = '0x482eE9510074bbdA290211320a01f95527DA8d4e';

async function testWithdraw() {
    await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [userWalletAddress],
      });

      const fromSigner = await ethers.getSigner(userWalletAddress);

    const tempusControllerContract = await ethers.getContractAt('TempusController', tempusControllerAddress);

    await tempusControllerContract.connect(fromSigner).exitAmmGivenLpAndRedeem(
        '0xA2979C4a7A447919BF86798C4bd2B589b2F45E1b', // tempusAMM,
        ethers.BigNumber.from('0x00'), // lpTokensAmount
        ethers.BigNumber.from('0x87866d89f2be3c8000'), // principalsAmount
        ethers.BigNumber.from('0x821ab0d441497fffff'), // yieldsAmount
        ethers.BigNumber.from('0x0a8d3302fa0b52'), // minPrincipalsStaked
        ethers.BigNumber.from('0x055de6a778edd7c319'), // minYieldsStaked
        ethers.BigNumber.from('0x440063625f9b9358'), // maxLeftoverShares
        ethers.BigNumber.from('0x01'), // yieldsRate
        ethers.BigNumber.from('0x2386f26fc10000'), // maxSlippage
        false, // isBackingToken
        8640000000000000 // deadline (infinite)
    )
}

async function finalize() {
    const tempusPool48hContract = await ethers.getContractAt('TempusPool', '0x5DDCd1C60896581c710B37827C72eA424D302FB1');
    const tempusPool15mContract = await ethers.getContractAt('TempusPool', '0xE5d5508D57D0F2fC3BBB995613eA05744C32b244');

    await tempusPool48hContract.finalize();
    await tempusPool15mContract.finalize();
}

finalize();
