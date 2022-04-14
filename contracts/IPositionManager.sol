// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC721/extensions/IERC721Metadata.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "./amm/interfaces/ITempusAMM.sol";
import "./ITempusPool.sol";

/// @dev The Position Manager's purpose is to allow depositing funds to a Tempus Pool
/// and wrapping the minted Capitals and Yields into a non-fungible ERC721 token
interface IPositionManager is IERC721, IERC721Metadata {
    /// @dev Provided Leverage Multiplier is invalid
    error InvalidLeverageMultiplier();
    /// @dev Unauthorized position burn attempt
    error UnauthorizedBurn();
    /// @dev A Tempus AMM whose shares are of different TempusPools was provided
    error AmmSharesPoolMismatch();
    /// @dev An invalid Tempus Controller was provided
    error InvalidTempusController();

    /// @dev Holds information about an open position
    /// @param capitals Amount of Capitals owned by the position
    /// @param yields Amount of Yields owned by the position
    /// @param tempusAMM The Tempus AMM used to create the position
    struct Position {
        uint128 capitals;
        uint128 yields;
        ITempusAMM tempusAMM;
    }

    /// @param tempusAMM the Tempus AMM (and its Tempus Pool) to use for position creation
    /// @param leverageMultiplier For fixed positions, use leverageMultiplier = 0; For levarged positions, use leverageMultiplier > 1e18
    /// @param tokenAmountToDeposit Token amount to be deposited intto the Tempus Pool
    /// @param worstAcceptableCapitalsRate Worst acceptable Capitals rate for the internal Capitals <--> Yields swap
    /// @param deadline A timestamp by which, if a swap is necessary, the transaction must be completed
    /// @param recipient Recipient to be granted ownership of the position
    /// @param isBackingToken Specfies whether to deposit Backing Tokens or Yield Bearing Tokens
    struct MintParams {
        ITempusAMM tempusAMM;
        uint256 leverageMultiplier;
        uint256 tokenAmountToDeposit;
        uint256 worstAcceptableCapitalsRate;
        uint256 deadline;
        address recipient;
        bool isBackingToken;
    }

    /// @param maxLeftoverShares Maximum amount of Principals/Yields to be left in case early exit swap is necessary
    /// @param yieldsRate Base exchange rate of Yields (denominated in Capitals)
    /// @param maxSlippage Maximum allowed change in the exchange rate from the base yieldsRate (1e18 precision)
    /// @param deadline A timestamp by which, if a swap is necessary, the transaction must be completed
    /// @param recipient Recipient to be receive the funds received from position liquidation
    /// @param toBackingToken Specfies whether to withdraw to Backing Tokens or Yield Bearing Tokens
    struct BurnParams {
        uint256 maxLeftoverShares;
        uint256 yieldsRate;
        uint256 maxSlippage;
        uint256 deadline;
        address recipient;
        bool toBackingToken;
    }

    /// @dev Deposits funds into a provided TempusPool and mints
    ///      a non-fungible token that represents that position
    /// @notice this function can be used to mint both fixed rate positions and leveraged positions.
    ///         to mint a leveraged position, use a leverageMultiplier that is greater than 1e18;
    ///         to mint a fixed rate position, use 0 as the leverageMultiplier.
    /// @param params Instructions for position creation
    /// @return tokenId of the minted position
    function mint(MintParams calldata params) external payable returns (uint256 tokenId);

    /// @dev Burns a non-fungible positions and liquidates its value to the position owner
    /// @param tokenId Token ID to burn
    /// @param params Instructions for position liquidation
    /// @return liquidatedTokenAmount as a result of burning the position
    function burn(uint256 tokenId, BurnParams calldata params) external returns (uint256 liquidatedTokenAmount);

    /// @dev retrieves position data for a given token ID.
    function position(uint256 tokenId) external view returns (Position memory);
}
