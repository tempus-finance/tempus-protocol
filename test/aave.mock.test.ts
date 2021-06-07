import { ethers } from "hardhat";
import { Signer } from "ethers";

async function deploy(name, args) {
  let factory = await ethers.getContractFactory(name);
  return await factory.deploy(...args);
}

describe("AAVE Mock", async () => {
  let pool;
  let owner, addr1, addr2;

  beforeEach(async () => {
    // let backingToken      = await deploy("ERC20", ['DAI Stablecoin', 'DAI']);
    // let yieldBearingToken = await deploy("ATokenMock", ['AAVE AToken', 'aDAI']);
    // let debtToken         = await deploy("ATokenMock", ['AAVE AToken', 'aDAI']);
    [owner, addr1, addr2] = await ethers.getSigners();
    // pool = await deploy('AavePoolMock', [backingToken, yieldBearingToken, debtToken]);
  });

  describe("Deposit", async () =>
  {
    it("Should deposit the correct amount", async () =>
    {
      //pool.connect(addr1).deposit(50);
    });
  });
});
