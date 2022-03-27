import { run, ethers } from 'hardhat';
import * as prompt from "prompt";

if (!process.env.ETHERSCAN_API_KEY) {
  throw new Error("ETHERSCAN_API_KEY env var must be defined");
}

if (!process.env.TEMPUS_POOL_CONTRACT) {
  throw new Error("TEMPUS_POOL_CONTRACT env var must be defined")
}

function reverse(s){
  return s.split("").reverse().join("");
}

async function tryVerifyingSource(contractName: string, contractAddress: string, constructorArgs: any[]) {
  try {
    await run("verify:verify", {
      address: contractAddress,
      constructorArguments: constructorArgs
    });
    console.log(console.log(`Successfully verified ${contractName} on Etherscan - ${contractAddress}`));
  }
  catch (e) {
    if (e.message.includes("Contract source code already verified")) {
      console.log(console.log(`${contractName} source code is already verified on Etherscan`))
      return;
    }
    throw e;
  }
}

async function extractConstructorArgsFromDeploymentInput(contractAddress, contractDeploymentTxId) {
  const contractCode = await ethers.provider.getCode(contractAddress);
  const { data } = await ethers.provider.getTransaction(contractDeploymentTxId);

  /// This assumes the serialized constructor arguments are appended
  //// at the end of the contract deployment tx input (lookup is done using last 8 chars of the contract bytecode).
  const tempusAmmDeploymentInputConstructorArgsIndex = data.length - reverse(data).indexOf(reverse(contractCode.substr(contractCode.length - 8)))
  return "0x" + data.substr(tempusAmmDeploymentInputConstructorArgsIndex);
}

async function main(tempusPoolContractName) {
  console.log(console.log(`Verifying ${tempusPoolContractName} on Etherscan...`));

  const { tempusAmmAddress, tempusAmmDeploymentTxId, tempusPoolDeploymentTxId } = await prompt.get(["tempusAmmAddress", "tempusAmmDeploymentTxId", "tempusPoolDeploymentTxId"]);
  const tempusAMM = await ethers.getContractAt("TempusAMM", tempusAmmAddress);

  const tempusPool = await ethers.getContractAt(tempusPoolContractName, await tempusAMM.tempusPool()); 
  const principals = await ethers.getContractAt("PrincipalShare", await tempusPool.principalShare());
  const yields = await ethers.getContractAt("YieldShare", await tempusPool.yieldShare());

  const tempusAmmConstructorArgsHex = await extractConstructorArgsFromDeploymentInput(tempusAmmAddress, tempusAmmDeploymentTxId);
  const tempusPoolConstructorArgsHex = await extractConstructorArgsFromDeploymentInput(tempusPool.address, tempusPoolDeploymentTxId);
  
  const tempusAMMConstructorArgs = [...ethers.utils.defaultAbiCoder.decode(tempusAMM.interface.deploy.inputs, tempusAmmConstructorArgsHex)];
  const tempusPoolConstructorArgs = [...ethers.utils.defaultAbiCoder.decode(tempusPool.interface.deploy.inputs, tempusPoolConstructorArgsHex)];
  
  await tryVerifyingSource("TempusAMM", tempusAMM.address, tempusAMMConstructorArgs);
  await tryVerifyingSource(tempusPoolContractName, tempusPool.address, tempusPoolConstructorArgs);
  await tryVerifyingSource("PrincipalShare", principals.address, await Promise.all([tempusPool.address, principals.name(), principals.symbol(), principals.decimals()]));
  await tryVerifyingSource("YieldShare", yields.address, await Promise.all([tempusPool.address, yields.name(), yields.symbol(), yields.decimals()]));
}

main(process.env.TEMPUS_POOL_CONTRACT)