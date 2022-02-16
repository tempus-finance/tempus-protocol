import { PoolTestFixture } from "./PoolTestFixture";
import { AaveTestPool } from "./AaveTestPool";
import { LidoTestPool } from "./LidoTestPool";
import { RariTestPool } from "./RariTestPool";
import { YearnTestPool } from "./YearnTestPool";
import { TokenInfo } from "./TokenInfo";
import { CompoundTestPool } from "./CompoundTestPool";
import { PoolType } from "../utils/TempusPool";
import { Suite, TestFunction, Func, Test } from "mocha";
import { 
  isIntegrationTestsEnabled, getOnlyRunPool, getOnlyRunToken, getTokens, ALL_POOLS
} from "../Config";

const integration = isIntegrationTestsEnabled();
const onlyRun = getOnlyRunPool();
const onlyToken = getOnlyRunToken();
const tokens = getTokens(integration);

function _describeForEachPoolType(title:string, poolTypes:PoolType[], only:boolean, fn:(pool:PoolTestFixture) => void)
{
  let parent:Suite = null;

  for (let type of poolTypes)
  {
    if (onlyRun && onlyRun !== type) {
      continue;
    }

    if (!tokens[type]) {
      console.log("No tokens defined for %s", type)
      continue;
    }

    for (let pair of tokens[type]) {
      let asset:TokenInfo = pair[0];
      let yieldToken:TokenInfo = pair[1];

      if (onlyToken && onlyToken !== asset.symbol) {
        continue;
      }

      const describeTestBody = () =>
      {
        let pool:PoolTestFixture;
        switch (type) {
          case PoolType.Aave:     pool = new AaveTestPool(asset, yieldToken, integration); break;
          case PoolType.Lido:     pool = new LidoTestPool(asset, yieldToken, integration); break;
          case PoolType.Compound: pool = new CompoundTestPool(asset, yieldToken, integration); break;
          case PoolType.Yearn:    pool = new YearnTestPool(asset, yieldToken, integration); break;
          case PoolType.Rari:     pool = new RariTestPool(asset, yieldToken, integration); break;
        }
        fn(pool);
      };
  
      // we want to describe suites by underlying pool type Prefix
      // this means tests are grouped and run by pool type, making fixtures faster
      const suiteTitle = type.toString() + " " + yieldToken.symbol + " <> " + title;
      let suite:Suite = only ? describe.only(suiteTitle, describeTestBody) : describe(suiteTitle, describeTestBody);
      parent = suite.parent;
    }
  }

  // make sure to sort these suites by title
  parent?.suites.sort((a:Suite, b:Suite) => a.title.localeCompare(b.title));
  return parent;
}

function _describeForNonePoolType(title:string, only:boolean, fn:() => void)
{
  // if ONLY_POOL was not passed from command line, then run this suite
  //    - used for current Coveralls use case
  //
  // OR we expect command line argument ONLY_POOL=None to run this suite,
  // which is sent by the parallel run script
  if (!onlyRun || onlyRun === PoolType.None) {
    if (only) {
      describe.only(title, fn);
    } else {
      describe(title, fn);
    }
  }
}

interface MultiPoolSuiteFunction {
  /**
   * Batch describes unit test block for each specified PoolType
   */
  (title:string, fn:(pool:PoolTestFixture) => void): void;

  /**
   * Batch describes unit test block for specific PoolTypes
   */
  type: (title:string, poolTypes:PoolType[], fn:(pool:PoolTestFixture) => void) => void;

  /**
   * Indicates this suite should be executed exclusively.
   */
  only: (title:string, fn:(pool:PoolTestFixture) => void) => void;

  /**
   * Combines only() and type()
   */
  onlyType: (title:string, poolTypes:PoolType[], fn:(Pool:PoolTestFixture) => void) => void;
}

interface NonePoolSuiteFunction {
  /**
   * Describes unit test block only for PoolType.None
   */
  (title:string, fn:() => void): void;

  /**
   * Indicates this suite should be executed exclusively.
   */
  only: (title:string, fn:() => void) => void;
}

interface IntegrationExclusiveTestFunction extends TestFunction {
  includeIntegration: (title: string, fn?: Func) => Test;
}

/**
 * Batch describes unit test block for all PoolTypes
 */
export const describeForEachPool: MultiPoolSuiteFunction = (() => {
  const f:MultiPoolSuiteFunction = (title:string, fn:(pool:PoolTestFixture) => void) => {
    _describeForEachPoolType(title, ALL_POOLS, /*only*/false, fn);
  };
  f.type = (title:string, poolTypes:PoolType[], fn:(pool:PoolTestFixture) => void) => {
    _describeForEachPoolType(title, poolTypes, /*only*/false, fn);
  };
  f.only = (title:string, fn:(pool:PoolTestFixture) => void) => {
    _describeForEachPoolType(title, ALL_POOLS, /*only*/true, fn);
  };
  f.onlyType = (title:string, poolTypes:PoolType[], fn:(pool:PoolTestFixture) => void) => {
    _describeForEachPoolType(title, poolTypes, /*only*/true, fn);
  }
  return f;
})();

/**
 * For declaring other tests that are independent of pool type
 */
export const describeNonPool: NonePoolSuiteFunction = (() => {
  const f:NonePoolSuiteFunction = (title:string, fn:() => void) => {
    _describeForNonePoolType(title, /*only*/false, fn);
  };
  f.only = (title:string, fn:() => void) => {
    _describeForNonePoolType(title, /*only*/true, fn);
  };
  return f;
})();


/**
 * Extends Mocha's it()'s functionality with a includeIntegration which marks a
 * unit test to be ran as integration test as well
 */
//  export const integrationExclusiveIt = originalIt;
export const integrationExclusiveIt: IntegrationExclusiveTestFunction = ((name: string, impl: Func) => {
  return integration ? it.skip(name, impl) : it(name, impl);
}) as IntegrationExclusiveTestFunction;

integrationExclusiveIt.only = it.only;
integrationExclusiveIt.retries = it.retries;
integrationExclusiveIt.skip = it.skip;
integrationExclusiveIt.includeIntegration = function (name: string, impl: Func) {
  return it(name, impl);
};
