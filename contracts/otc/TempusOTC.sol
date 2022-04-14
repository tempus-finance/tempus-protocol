// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "./ITempusOTC.sol";

contract TempusOTC is ITempusOTC, ReentrancyGuard {
    IERC20 public immutable tokenToBuy;
    IERC20 public immutable tokenToSell;
    uint256 public immutable buyAmount;
    uint256 public immutable sellAmount;
    address public immutable maker;
    address public immutable taker;

    constructor(
        IERC20 _tokenToBuy,
        IERC20 _tokenToSell,
        uint256 _buyAmount,
        uint256 _sellAmount,
        address _taker
    ) {
        tokenToBuy = _tokenToBuy;
        tokenToSell = _tokenToSell;
        buyAmount = _buyAmount;
        sellAmount = _sellAmount;
        maker = msg.sender;
        taker = _taker;

        tokenToBuy.transferFrom(msg.sender, address(this), buyAmount);
    }

    function buy() external nonReentrant {
        if (msg.sender != taker) {
            revert TakerNotSameAsMsgSender();
        }

        tokenToSell.transferFrom(msg.sender, maker, sellAmount);

        tokenToBuy.transfer(msg.sender, buyAmount);
    }

    function cancel() external {
        if (msg.sender != maker) {
            revert MakerNotSameAsMsgSender();
        }

        tokenToBuy.transfer(msg.sender, buyAmount);
    }
}
