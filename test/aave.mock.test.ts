import { ethers } from "hardhat";
import { Signer } from "ethers";

describe("AAVE Mock", async () => {
  let pool;
  let owner, addr1, addr2;

  beforeEach(async () => {
    [owner, addr1, addr2] = await ethers.getSigners();

    let BackingToken = await ethers.getContractFactory("ERC20FixedSupply");
    let backingToken = await BackingToken.deploy("DAI Stablecoin", "DAI", 1000000);

    let ATokenMock = await ethers.getContractFactory("ATokenMock");
    let yieldBearingToken = await ATokenMock.deploy('AAVE AToken', 'aDAI');
    let debtToken         = await ATokenMock.deploy('AAVE AToken', 'aDAI');

    let AavePoolMock = ethers.getContractFactory("AavePoolMock");
    pool = await (await AavePoolMock).deploy(
      backingToken.address, 
      yieldBearingToken.address, 
      debtToken.address
    );
  });

  describe("Deposit", async () =>
  {
    it("Should deposit the correct amount", async () =>
    {
      pool.connect(addr1).deposit(50);
    });
  });
});
