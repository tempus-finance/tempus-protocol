import { Contract } from "ethers";
import { ContractBase, Signer, Addressable, addressOf } from "@tempus-labs/utils/ts/utils/ContractBase";
import { Numberish } from "@tempus-labs/utils/ts/utils/DecimalUtils";
import { ERC20 } from "@tempus-labs/utils/ts/token/ERC20";
import { TempusAMM } from "./TempusAMM";
import { TempusPool } from "./TempusPool";
import { Stats } from "./Stats";
import { assert } from "console";

export class LPVault extends ERC20 {
  ybt:ERC20;

  constructor(contractName: string, decimals: number, ybt: ERC20, contract: Contract) {
    super(contractName, decimals/*default decimals*/, contract);
    this.ybt = ybt;
  }

  static async create(pool: TempusPool, amm: TempusAMM, stats: Stats, name: string, symbol: string): Promise<LPVault> {
    const lpVault = await ContractBase.deployContract("LPVaultV1", pool.address, amm.address, stats.address, name, symbol);
    const vault = new LPVault("LPVaultV1", await lpVault.decimals(), pool.yieldBearing, lpVault);
    assert(vault.decimals == vault.ybt.decimals, "Vault.decimals must equal Vault.YBT.decimals");
    return vault;
  }

  async previewDeposit(caller: Signer, amount: Numberish): Promise<Numberish> {
    return this.ybt.fromBigNum(await this.connect(caller).previewDeposit(this.ybt.toBigNum(amount)));
  }

  async deposit(caller: Signer, amount: Numberish, recipient: Addressable): Promise<void> {
    await this.connect(caller).deposit(this.ybt.toBigNum(amount), addressOf(recipient));
  }

  async previewWithdraw(caller: Signer, shares: Numberish): Promise<Numberish> {
    return this.ybt.fromBigNum(await this.connect(caller).previewWithdraw(this.ybt.toBigNum(shares)));
  }

  async withdraw(caller: Signer, shares: Numberish, recipient: Addressable): Promise<void> {
    await this.connect(caller).withdraw(this.ybt.toBigNum(shares), addressOf(recipient));
  }

  async migrate(caller: Signer, pool: TempusPool, amm: TempusAMM, stats: Stats): Promise<void> {
    await this.connect(caller).migrate(pool.address, amm.address, stats.address);
  }

  async isShutdown(): Promise<Boolean> {
    return this.contract.isShutdown();
  }

  async shutdown(caller: Signer): Promise<void> {
    await this.connect(caller).shutdown();
  }

  async totalAssets(): Promise<Numberish> {
    return this.ybt.toDecimal(await this.contract.totalAssets());
  }
}
