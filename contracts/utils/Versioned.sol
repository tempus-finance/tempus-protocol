// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9.0;

import "./IVersioned.sol";

/// Implements versioning
abstract contract Versioned is IVersioned {
    uint16 private immutable _major;
    uint16 private immutable _minor;
    uint16 private immutable _patch;

    constructor(
        uint16 major,
        uint16 minor,
        uint16 patch
    ) {
        _major = major;
        _minor = minor;
        _patch = patch;
    }

    function version() external view returns (Version memory) {
        return Version(_major, _minor, _patch);
    }
}
