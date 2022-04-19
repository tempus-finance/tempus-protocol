import { ethers, getNamedAccounts, network } from "hardhat";
import { parseDecimal, toWei } from "../../../test/utils/Decimal";
import { ERC20 } from "../../../test/utils/ERC20";

export async function increaseYield() {
    const { lidoOracleMember1, lidoOracleMember2, lidoOracleMember3 } = await getNamedAccounts();

    const lido = new ERC20("ILido", 18, (await ethers.getContract('Lido')));
    const lidoOracle = await ethers.getContract('LidoOracle');

    const { beaconValidators, beaconBalance } = await lido.contract.getBeaconStat();
    const newBeaconBalance = ethers.BigNumber.from(beaconBalance.toString()).add(toWei(100 + (Math.random() * 5))).div(parseDecimal('1', 9));

    await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [lidoOracleMember1],
      });
      const lidoOracleMember1Signer = await ethers.getSigner(lidoOracleMember1);
    await lidoOracle.connect(lidoOracleMember1Signer).reportBeacon((await lidoOracle.getExpectedEpochId()), newBeaconBalance, beaconValidators);

    await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [lidoOracleMember2],
      });
      const lidoOracleMember2Signer = await ethers.getSigner(lidoOracleMember2);
    await lidoOracle.connect(lidoOracleMember2Signer).reportBeacon((await lidoOracle.getExpectedEpochId()), newBeaconBalance, beaconValidators);

    await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [lidoOracleMember3],
      });
      const lidoOracleMember3Signer = await ethers.getSigner(lidoOracleMember3);
    await lidoOracle.connect(lidoOracleMember3Signer).reportBeacon((await lidoOracle.getExpectedEpochId()), newBeaconBalance, beaconValidators);
}
