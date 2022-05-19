import { expect } from "chai";
import { Signer } from "../utils/ContractBase";
import { describeNonPool } from "../pool-utils/MultiPoolTestSuite";
import { TempusOTC } from "../tempus/TempusOTC";
import { ethers } from "hardhat";
import { ERC20OwnerMintable } from "../tempus/ERC20OwnerMintable";
import { expectRevert } from "../utils/Utils";

describeNonPool("TempusOTC", async() =>
{
  let maker:Signer, taker:Signer;
  let tempusOTC:TempusOTC;
  
  let buyAmount:number;
  let sellAmount:number;

  let tokenToBuyMakerAmount:number;
  let tokenToBuyTakerAmount:number;
  let tokenToSellMakerAmount:number;
  let tokenToSellTakerAmount:number;

  beforeEach(async () =>
  {
    [maker, taker] = await ethers.getSigners();

    const tokenToBuy = await ERC20OwnerMintable.create("ERC20OwnerMintableToken", "Owner Mintable Test Token To Buy", "OTESTBUY");
    const tokenToSell = await ERC20OwnerMintable.create("ERC20OwnerMintableToken", "Owner Mintable Test Token To Sell", "OTESTSELL");
    
    tokenToBuyMakerAmount = tokenToBuyTakerAmount = tokenToSellMakerAmount = tokenToSellTakerAmount = 100;

    await tokenToBuy.mint(maker, maker, tokenToBuyMakerAmount);
    await tokenToBuy.mint(maker, taker, tokenToBuyTakerAmount);

    await tokenToSell.mint(maker, maker, tokenToSellMakerAmount);
    await tokenToSell.mint(maker, taker, tokenToSellTakerAmount);

    buyAmount = 1;
    sellAmount = 2;

    tempusOTC = await TempusOTC.create(
      maker,
      tokenToBuy,
      tokenToSell,
      buyAmount,
      sellAmount,
      taker.address
    );

    tokenToBuyMakerAmount -= buyAmount;
  });

  it("check create offer (contract deploy) works good", async () =>
  {
    expect(+await tempusOTC.tokenToBuy.balanceOf(tempusOTC.address)).to.equal(buyAmount);
  });

  it("check if [buy] works good", async () =>
  {
    await tempusOTC.buy(taker);

    expect(+await tempusOTC.tokenToBuy.balanceOf(tempusOTC.address)).to.equal(0);
    expect(+await tempusOTC.tokenToBuy.balanceOf(maker)).to.equal(tokenToBuyMakerAmount);
    expect(+await tempusOTC.tokenToBuy.balanceOf(taker)).to.equal(tokenToBuyTakerAmount + buyAmount);

    expect(+await tempusOTC.tokenToSell.balanceOf(tempusOTC.address)).to.equal(0);
    expect(+await tempusOTC.tokenToSell.balanceOf(maker)).to.equal(tokenToSellMakerAmount + sellAmount);
    expect(+await tempusOTC.tokenToSell.balanceOf(taker)).to.equal(tokenToSellTakerAmount - sellAmount);
  });

  it("check if [buy] reverts", async () => 
  {
    (await expectRevert(tempusOTC.buy(maker))).to.equal(':TakerNotSameAsMsgSender');
  });

  it("check reverts after [buy]", async () => 
  {
    await tempusOTC.buy(taker);

    (await expectRevert(tempusOTC.cancel(maker))).to.equal('ERC20: transfer amount exceeds balance');

    (await expectRevert(tempusOTC.buy(taker))).to.equal('ERC20: transfer amount exceeds balance');
  });

  it("check if [cancel] works good", async () =>
  {
    await tempusOTC.cancel(maker);

    expect(+await tempusOTC.tokenToBuy.balanceOf(tempusOTC.address)).to.equal(0);
    expect(+await tempusOTC.tokenToBuy.balanceOf(maker)).to.equal(tokenToBuyMakerAmount + buyAmount);
    expect(+await tempusOTC.tokenToBuy.balanceOf(taker)).to.equal(tokenToBuyTakerAmount);

    expect(+await tempusOTC.tokenToSell.balanceOf(tempusOTC.address)).to.equal(0);
    expect(+await tempusOTC.tokenToSell.balanceOf(maker)).to.equal(tokenToSellMakerAmount);
    expect(+await tempusOTC.tokenToSell.balanceOf(taker)).to.equal(tokenToSellTakerAmount);
  });

  it("check if [cancel] reverts", async () => 
  {
    (await expectRevert(tempusOTC.cancel(taker))).to.equal(':MakerNotSameAsMsgSender');
  });

  it("check reverts after [cancel]", async () => 
  {
    await tempusOTC.cancel(maker);

    (await expectRevert(tempusOTC.cancel(maker))).to.equal('ERC20: transfer amount exceeds balance');

    (await expectRevert(tempusOTC.buy(taker))).to.equal('ERC20: transfer amount exceeds balance');
  });
});
