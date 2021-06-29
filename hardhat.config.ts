import { task } from "hardhat/config";
import "hardhat-gas-reporter";
import "@nomiclabs/hardhat-waffle";

require('solidity-coverage');

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (args, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(await account.address);
  }
});


/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    compilers: [{
      version: "0.8.6",
      settings: {
        optimizer: {
          enabled: true,
          runs: 10000
        }
      }
    },
    {
      version: "0.7.6",
      settings: {
        optimizer: {
          enabled: true,
          runs: 400
        }
      }
    }]
  },
};
