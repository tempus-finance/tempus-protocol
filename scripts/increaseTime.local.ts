import { blockTimestamp, increaseTime } from "@tempus-sdk/utils/Utils";

async function main() {
  console.log('Block timestamp before: ', await blockTimestamp());
  await increaseTime(60*60*24);
  console.log('Time increased to: ', await blockTimestamp());
}
  
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
  