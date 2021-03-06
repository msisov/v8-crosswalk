// Copyright 2006-2008 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// This file contains support for URI manipulations written in
// JavaScript.

(function(global, utils) {

"use strict";

%CheckIsBootstrapping();

//- ------------------------------------------------------------------
// Imports

var GlobalObject = global.Object;
var InternalArray = utils.InternalArray;
var MakeURIError;

utils.Import(function(from) {
  MakeURIError = from.MakeURIError;
});


// -------------------------------------------------------------------
// Define internal helper functions.

function HexValueOf(code) {
  // 0-9
  if (code >= 48 && code <= 57) return code - 48;
  // A-F
  if (code >= 65 && code <= 70) return code - 55;
  // a-f
  if (code >= 97 && code <= 102) return code - 87;

  return -1;
}

function URIHexCharsToCharCode(highChar, lowChar) {
  var highCode = HexValueOf(highChar);
  var lowCode = HexValueOf(lowChar);
  if (highCode == -1 || lowCode == -1) throw MakeURIError();
  return (highCode << 4) | lowCode;
}

// Callers must ensure that |result| is a sufficiently long sequential
// two-byte string!
function URIDecodeOctets(octets, result, index) {
  var value;
  var o0 = octets[0];
  if (o0 < 0x80) {
    value = o0;
  } else if (o0 < 0xc2) {
    throw MakeURIError();
  } else {
    var o1 = octets[1];
    if (o0 < 0xe0) {
      var a = o0 & 0x1f;
      if ((o1 < 0x80) || (o1 > 0xbf)) throw MakeURIError();
      var b = o1 & 0x3f;
      value = (a << 6) + b;
      if (value < 0x80 || value > 0x7ff) throw MakeURIError();
    } else {
      var o2 = octets[2];
      if (o0 < 0xf0) {
        var a = o0 & 0x0f;
        if ((o1 < 0x80) || (o1 > 0xbf)) throw MakeURIError();
        var b = o1 & 0x3f;
        if ((o2 < 0x80) || (o2 > 0xbf)) throw MakeURIError();
        var c = o2 & 0x3f;
        value = (a << 12) + (b << 6) + c;
        if ((value < 0x800) || (value > 0xffff)) throw MakeURIError();
      } else {
        var o3 = octets[3];
        if (o0 < 0xf8) {
          var a = (o0 & 0x07);
          if ((o1 < 0x80) || (o1 > 0xbf)) throw MakeURIError();
          var b = (o1 & 0x3f);
          if ((o2 < 0x80) || (o2 > 0xbf)) {
            throw MakeURIError();
          }
          var c = (o2 & 0x3f);
          if ((o3 < 0x80) || (o3 > 0xbf)) throw MakeURIError();
          var d = (o3 & 0x3f);
          value = (a << 18) + (b << 12) + (c << 6) + d;
          if ((value < 0x10000) || (value > 0x10ffff)) throw MakeURIError();
        } else {
          throw MakeURIError();
        }
      }
    }
  }
  if (0xD800 <= value && value <= 0xDFFF) throw MakeURIError();
  if (value < 0x10000) {
    %_TwoByteSeqStringSetChar(index++, value, result);
  } else {
    %_TwoByteSeqStringSetChar(index++, (value >> 10) + 0xd7c0, result);
    %_TwoByteSeqStringSetChar(index++, (value & 0x3ff) + 0xdc00, result);
  }
  return index;
}

// ECMA-262, section 15.1.3
function Decode(uri, reserved) {
  uri = TO_STRING(uri);
  var uriLength = uri.length;
  var one_byte = %NewString(uriLength, NEW_ONE_BYTE_STRING);
  var index = 0;
  var k = 0;

  // Optimistically assume one-byte string.
  for ( ; k < uriLength; k++) {
    var code = %_StringCharCodeAt(uri, k);
    if (code == 37) {  // '%'
      if (k + 2 >= uriLength) throw MakeURIError();
      var cc = URIHexCharsToCharCode(%_StringCharCodeAt(uri, k+1),
                                     %_StringCharCodeAt(uri, k+2));
      if (cc >> 7) break;  // Assumption wrong, two-byte string.
      if (reserved(cc)) {
        %_OneByteSeqStringSetChar(index++, 37, one_byte);  // '%'.
        %_OneByteSeqStringSetChar(index++, %_StringCharCodeAt(uri, k+1),
                                  one_byte);
        %_OneByteSeqStringSetChar(index++, %_StringCharCodeAt(uri, k+2),
                                  one_byte);
      } else {
        %_OneByteSeqStringSetChar(index++, cc, one_byte);
      }
      k += 2;
    } else {
      if (code > 0x7f) break;  // Assumption wrong, two-byte string.
      %_OneByteSeqStringSetChar(index++, code, one_byte);
    }
  }

  one_byte = %TruncateString(one_byte, index);
  if (k == uriLength) return one_byte;

  // Write into two byte string.
  var two_byte = %NewString(uriLength - k, NEW_TWO_BYTE_STRING);
  index = 0;

  for ( ; k < uriLength; k++) {
    var code = %_StringCharCodeAt(uri, k);
    if (code == 37) {  // '%'
      if (k + 2 >= uriLength) throw MakeURIError();
      var cc = URIHexCharsToCharCode(%_StringCharCodeAt(uri, ++k),
                                     %_StringCharCodeAt(uri, ++k));
      if (cc >> 7) {
        var n = 0;
        while (((cc << ++n) & 0x80) != 0) { }
        if (n == 1 || n > 4) throw MakeURIError();
        var octets = new InternalArray(n);
        octets[0] = cc;
        if (k + 3 * (n - 1) >= uriLength) throw MakeURIError();
        for (var i = 1; i < n; i++) {
          if (uri[++k] != '%') throw MakeURIError();
          octets[i] = URIHexCharsToCharCode(%_StringCharCodeAt(uri, ++k),
                                            %_StringCharCodeAt(uri, ++k));
        }
        index = URIDecodeOctets(octets, two_byte, index);
      } else  if (reserved(cc)) {
        %_TwoByteSeqStringSetChar(index++, 37, two_byte);  // '%'.
        %_TwoByteSeqStringSetChar(index++, %_StringCharCodeAt(uri, k - 1),
                                  two_byte);
        %_TwoByteSeqStringSetChar(index++, %_StringCharCodeAt(uri, k),
                                  two_byte);
      } else {
        %_TwoByteSeqStringSetChar(index++, cc, two_byte);
      }
    } else {
      %_TwoByteSeqStringSetChar(index++, code, two_byte);
    }
  }

  two_byte = %TruncateString(two_byte, index);
  return one_byte + two_byte;
}

// -------------------------------------------------------------------
// Define exported functions.

// ECMA-262 - B.2.1.
function URIEscapeJS(s) {
  return %URIEscape(s);
}

// ECMA-262 - B.2.2.
function URIUnescapeJS(s) {
  return %URIUnescape(s);
}

// ECMA-262 - 15.1.3.1.
function URIDecode(uri) {
  var reservedPredicate = function(cc) {
    // #$
    if (35 <= cc && cc <= 36) return true;
    // &
    if (cc == 38) return true;
    // +,
    if (43 <= cc && cc <= 44) return true;
    // /
    if (cc == 47) return true;
    // :;
    if (58 <= cc && cc <= 59) return true;
    // =
    if (cc == 61) return true;
    // ?@
    if (63 <= cc && cc <= 64) return true;

    return false;
  };
  return Decode(uri, reservedPredicate);
}

// ECMA-262 - 15.1.3.2.
function URIDecodeComponent(component) {
  var reservedPredicate = function(cc) { return false; };
  return Decode(component, reservedPredicate);
}

// -------------------------------------------------------------------
// Install exported functions.

// Set up non-enumerable URI functions on the global object and set
// their names.
utils.InstallFunctions(global, DONT_ENUM, [
  "escape", URIEscapeJS,
  "unescape", URIUnescapeJS,
  "decodeURI", URIDecode,
  "decodeURIComponent", URIDecodeComponent
]);

})
