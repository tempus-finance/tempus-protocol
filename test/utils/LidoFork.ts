import { ethers } from "hardhat";
import { BigNumber, Contract } from "ethers";
import { Numberish, parseDecimal } from "./Decimal";
import { setStorageField } from "./Utils";
import { ERC20Ether } from "./ERC20Ether";
import { TokenInfo } from "../pool-utils/TokenInfo";
import { LidoContract } from "./LidoContract";

export class LidoFork extends LidoContract {
  lidoOracle:Contract;

  constructor(contractName:string, pool:Contract, asset:ERC20Ether, oracle:Contract) {
    super(contractName, pool, asset);
    this.lidoOracle = oracle;
  }

  /**
   * @param YIELD YIELD token info
   * @param initialRate Initial interest rate
   */
  static async create(_:TokenInfo, YIELD:TokenInfo, initialRate:Number): Promise<LidoFork> {
    const asset = new ERC20Ether();
    const pool = (await ethers.getContract(YIELD.deploymentName!));
    const oracle = await ethers.getContract('LidoOracle');
    const lido = new LidoFork(YIELD.deploymentName, pool, asset, oracle);
    await lido.setInterestRate(initialRate);
    return lido;
  }

  async getBeaconBalance(): Promise<BigNumber> {
    // { depositedValidators, beaconValidators, beaconBalance }
    const { beaconBalance } = await this.contract.getBeaconStat();
    return beaconBalance;
  }

  /**
   * In order to set Lido's interest rate to the given value we change
   * the 2 parameters in Lido's interest rate formula (TotalPoolEther / TotalShares).
   * We set TotalPoolEther to the given interestRate value (scaled up to 1e36, as explained below)
   * and TotalShares to 1 (scaled up to 1e36 as well). This results in Lido's internal interest rate calculation
   * to be - TargetInterestRate / 1 (which equals TargetInterestRate of course).
   * 
   * @dev we scale up everything to 1e36 because the way we change TotalPoolEther is by changing the internal cached 
   * beaconBalance value (which is a component of TotalETHSupply), and by scaling everything up we avoid the potential situation where we need to set beaconBalance
   * to a negative value to achieve the desired TargetETHSupply.
   */
  async setInterestRate(interestRate:Numberish): Promise<void> {
    const totalETHSupply:BigNumber = await this.contract.totalSupply();
    
    const targetETHSupply = parseDecimal(interestRate, 36);
    const ethSupplyDiff = targetETHSupply.sub(totalETHSupply);

    const beaconBalance = await this.getBeaconBalance();
    const newBeaconBalance:BigNumber = beaconBalance.add(ethSupplyDiff);
    
    await setStorageField(this.contract, "lido.Lido.beaconBalance", newBeaconBalance);
    await setStorageField(this.contract, "lido.StETH.totalShares", parseDecimal('1', 36));
  }
}
