import { ITestPool } from "./ITestPool";
import { AaveTestPool } from "./AaveTestPool";
import { LidoTestPool } from "./LidoTestPool";
import { CompoundTestPool } from "./CompoundTestPool";
import { PoolType } from "../utils/TempusPool";

function createTestPool(type:PoolType): ITestPool {
  switch (type) {
    case PoolType.Aave: return new AaveTestPool();
    case PoolType.Lido: return new LidoTestPool(); 
    case PoolType.Compound: return new CompoundTestPool();
  }
}

/**
 * Batch describes unit test block for all PoolTypes
 */
export function describeForEachPool(title:string, fn:(pool:ITestPool) => void)
{
  describeForEachPoolType(title, [PoolType.Aave, PoolType.Lido, PoolType.Compound], fn);
}

/**
 * Batch describes unit test block for each specified PoolType
 */
export function describeForEachPoolType(title:string, poolTypes:PoolType[], fn:(pool:ITestPool) => void)
{
  for (let type of poolTypes)
  {
    describe(title + " <> " + type.toString(), () =>
    {
      const pool = createTestPool(type);
      fn(pool);
    });
  }
}
