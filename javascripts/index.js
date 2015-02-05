(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */

var base64 = require('base64-js')
var ieee754 = require('ieee754')

exports.Buffer = Buffer
exports.SlowBuffer = Buffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192

/**
 * If `Buffer._useTypedArrays`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (compatible down to IE6)
 */
Buffer._useTypedArrays = (function () {
  // Detect if browser supports Typed Arrays. Supported browsers are IE 10+, Firefox 4+,
  // Chrome 7+, Safari 5.1+, Opera 11.6+, iOS 4.2+. If the browser does not support adding
  // properties to `Uint8Array` instances, then that's the same as no `Uint8Array` support
  // because we need to be able to add all the node Buffer API methods. This is an issue
  // in Firefox 4-29. Now fixed: https://bugzilla.mozilla.org/show_bug.cgi?id=695438
  try {
    var buf = new ArrayBuffer(0)
    var arr = new Uint8Array(buf)
    arr.foo = function () { return 42 }
    return 42 === arr.foo() &&
        typeof arr.subarray === 'function' // Chrome 9-10 lack `subarray`
  } catch (e) {
    return false
  }
})()

/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (subject, encoding, noZero) {
  if (!(this instanceof Buffer))
    return new Buffer(subject, encoding, noZero)

  var type = typeof subject

  // Workaround: node's base64 implementation allows for non-padded strings
  // while base64-js does not.
  if (encoding === 'base64' && type === 'string') {
    subject = stringtrim(subject)
    while (subject.length % 4 !== 0) {
      subject = subject + '='
    }
  }

  // Find the length
  var length
  if (type === 'number')
    length = coerce(subject)
  else if (type === 'string')
    length = Buffer.byteLength(subject, encoding)
  else if (type === 'object')
    length = coerce(subject.length) // assume that object is array-like
  else
    throw new Error('First argument needs to be a number, array or string.')

  var buf
  if (Buffer._useTypedArrays) {
    // Preferred: Return an augmented `Uint8Array` instance for best performance
    buf = Buffer._augment(new Uint8Array(length))
  } else {
    // Fallback: Return THIS instance of Buffer (created by `new`)
    buf = this
    buf.length = length
    buf._isBuffer = true
  }

  var i
  if (Buffer._useTypedArrays && typeof subject.byteLength === 'number') {
    // Speed optimization -- use set if we're copying from a typed array
    buf._set(subject)
  } else if (isArrayish(subject)) {
    // Treat array-ish objects as a byte array
    for (i = 0; i < length; i++) {
      if (Buffer.isBuffer(subject))
        buf[i] = subject.readUInt8(i)
      else
        buf[i] = subject[i]
    }
  } else if (type === 'string') {
    buf.write(subject, 0, encoding)
  } else if (type === 'number' && !Buffer._useTypedArrays && !noZero) {
    for (i = 0; i < length; i++) {
      buf[i] = 0
    }
  }

  return buf
}

// STATIC METHODS
// ==============

Buffer.isEncoding = function (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.isBuffer = function (b) {
  return !!(b !== null && b !== undefined && b._isBuffer)
}

Buffer.byteLength = function (str, encoding) {
  var ret
  str = str + ''
  switch (encoding || 'utf8') {
    case 'hex':
      ret = str.length / 2
      break
    case 'utf8':
    case 'utf-8':
      ret = utf8ToBytes(str).length
      break
    case 'ascii':
    case 'binary':
    case 'raw':
      ret = str.length
      break
    case 'base64':
      ret = base64ToBytes(str).length
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = str.length * 2
      break
    default:
      throw new Error('Unknown encoding')
  }
  return ret
}

Buffer.concat = function (list, totalLength) {
  assert(isArray(list), 'Usage: Buffer.concat(list, [totalLength])\n' +
      'list should be an Array.')

  if (list.length === 0) {
    return new Buffer(0)
  } else if (list.length === 1) {
    return list[0]
  }

  var i
  if (typeof totalLength !== 'number') {
    totalLength = 0
    for (i = 0; i < list.length; i++) {
      totalLength += list[i].length
    }
  }

  var buf = new Buffer(totalLength)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

// BUFFER INSTANCE METHODS
// =======================

function _hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  assert(strLen % 2 === 0, 'Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var byte = parseInt(string.substr(i * 2, 2), 16)
    assert(!isNaN(byte), 'Invalid hex string')
    buf[offset + i] = byte
  }
  Buffer._charsWritten = i * 2
  return i
}

function _utf8Write (buf, string, offset, length) {
  var charsWritten = Buffer._charsWritten =
    blitBuffer(utf8ToBytes(string), buf, offset, length)
  return charsWritten
}

function _asciiWrite (buf, string, offset, length) {
  var charsWritten = Buffer._charsWritten =
    blitBuffer(asciiToBytes(string), buf, offset, length)
  return charsWritten
}

function _binaryWrite (buf, string, offset, length) {
  return _asciiWrite(buf, string, offset, length)
}

function _base64Write (buf, string, offset, length) {
  var charsWritten = Buffer._charsWritten =
    blitBuffer(base64ToBytes(string), buf, offset, length)
  return charsWritten
}

function _utf16leWrite (buf, string, offset, length) {
  var charsWritten = Buffer._charsWritten =
    blitBuffer(utf16leToBytes(string), buf, offset, length)
  return charsWritten
}

Buffer.prototype.write = function (string, offset, length, encoding) {
  // Support both (string, offset, length, encoding)
  // and the legacy (string, encoding, offset, length)
  if (isFinite(offset)) {
    if (!isFinite(length)) {
      encoding = length
      length = undefined
    }
  } else {  // legacy
    var swap = encoding
    encoding = offset
    offset = length
    length = swap
  }

  offset = Number(offset) || 0
  var remaining = this.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }
  encoding = String(encoding || 'utf8').toLowerCase()

  var ret
  switch (encoding) {
    case 'hex':
      ret = _hexWrite(this, string, offset, length)
      break
    case 'utf8':
    case 'utf-8':
      ret = _utf8Write(this, string, offset, length)
      break
    case 'ascii':
      ret = _asciiWrite(this, string, offset, length)
      break
    case 'binary':
      ret = _binaryWrite(this, string, offset, length)
      break
    case 'base64':
      ret = _base64Write(this, string, offset, length)
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = _utf16leWrite(this, string, offset, length)
      break
    default:
      throw new Error('Unknown encoding')
  }
  return ret
}

Buffer.prototype.toString = function (encoding, start, end) {
  var self = this

  encoding = String(encoding || 'utf8').toLowerCase()
  start = Number(start) || 0
  end = (end !== undefined)
    ? Number(end)
    : end = self.length

  // Fastpath empty strings
  if (end === start)
    return ''

  var ret
  switch (encoding) {
    case 'hex':
      ret = _hexSlice(self, start, end)
      break
    case 'utf8':
    case 'utf-8':
      ret = _utf8Slice(self, start, end)
      break
    case 'ascii':
      ret = _asciiSlice(self, start, end)
      break
    case 'binary':
      ret = _binarySlice(self, start, end)
      break
    case 'base64':
      ret = _base64Slice(self, start, end)
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = _utf16leSlice(self, start, end)
      break
    default:
      throw new Error('Unknown encoding')
  }
  return ret
}

Buffer.prototype.toJSON = function () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function (target, target_start, start, end) {
  var source = this

  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (!target_start) target_start = 0

  // Copy 0 bytes; we're done
  if (end === start) return
  if (target.length === 0 || source.length === 0) return

  // Fatal error conditions
  assert(end >= start, 'sourceEnd < sourceStart')
  assert(target_start >= 0 && target_start < target.length,
      'targetStart out of bounds')
  assert(start >= 0 && start < source.length, 'sourceStart out of bounds')
  assert(end >= 0 && end <= source.length, 'sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length)
    end = this.length
  if (target.length - target_start < end - start)
    end = target.length - target_start + start

  var len = end - start

  if (len < 100 || !Buffer._useTypedArrays) {
    for (var i = 0; i < len; i++)
      target[i + target_start] = this[i + start]
  } else {
    target._set(this.subarray(start, start + len), target_start)
  }
}

function _base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function _utf8Slice (buf, start, end) {
  var res = ''
  var tmp = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    if (buf[i] <= 0x7F) {
      res += decodeUtf8Char(tmp) + String.fromCharCode(buf[i])
      tmp = ''
    } else {
      tmp += '%' + buf[i].toString(16)
    }
  }

  return res + decodeUtf8Char(tmp)
}

function _asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++)
    ret += String.fromCharCode(buf[i])
  return ret
}

function _binarySlice (buf, start, end) {
  return _asciiSlice(buf, start, end)
}

function _hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function _utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i+1] * 256)
  }
  return res
}

Buffer.prototype.slice = function (start, end) {
  var len = this.length
  start = clamp(start, len, 0)
  end = clamp(end, len, len)

  if (Buffer._useTypedArrays) {
    return Buffer._augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    var newBuf = new Buffer(sliceLen, undefined, true)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
    return newBuf
  }
}

// `get` will be removed in Node 0.13+
Buffer.prototype.get = function (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` will be removed in Node 0.13+
Buffer.prototype.set = function (v, offset) {
  console.log('.set() is deprecated. Access using array indexes instead.')
  return this.writeUInt8(v, offset)
}

Buffer.prototype.readUInt8 = function (offset, noAssert) {
  if (!noAssert) {
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset < this.length, 'Trying to read beyond buffer length')
  }

  if (offset >= this.length)
    return

  return this[offset]
}

function _readUInt16 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  var val
  if (littleEndian) {
    val = buf[offset]
    if (offset + 1 < len)
      val |= buf[offset + 1] << 8
  } else {
    val = buf[offset] << 8
    if (offset + 1 < len)
      val |= buf[offset + 1]
  }
  return val
}

Buffer.prototype.readUInt16LE = function (offset, noAssert) {
  return _readUInt16(this, offset, true, noAssert)
}

Buffer.prototype.readUInt16BE = function (offset, noAssert) {
  return _readUInt16(this, offset, false, noAssert)
}

function _readUInt32 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  var val
  if (littleEndian) {
    if (offset + 2 < len)
      val = buf[offset + 2] << 16
    if (offset + 1 < len)
      val |= buf[offset + 1] << 8
    val |= buf[offset]
    if (offset + 3 < len)
      val = val + (buf[offset + 3] << 24 >>> 0)
  } else {
    if (offset + 1 < len)
      val = buf[offset + 1] << 16
    if (offset + 2 < len)
      val |= buf[offset + 2] << 8
    if (offset + 3 < len)
      val |= buf[offset + 3]
    val = val + (buf[offset] << 24 >>> 0)
  }
  return val
}

Buffer.prototype.readUInt32LE = function (offset, noAssert) {
  return _readUInt32(this, offset, true, noAssert)
}

Buffer.prototype.readUInt32BE = function (offset, noAssert) {
  return _readUInt32(this, offset, false, noAssert)
}

Buffer.prototype.readInt8 = function (offset, noAssert) {
  if (!noAssert) {
    assert(offset !== undefined && offset !== null,
        'missing offset')
    assert(offset < this.length, 'Trying to read beyond buffer length')
  }

  if (offset >= this.length)
    return

  var neg = this[offset] & 0x80
  if (neg)
    return (0xff - this[offset] + 1) * -1
  else
    return this[offset]
}

function _readInt16 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  var val = _readUInt16(buf, offset, littleEndian, true)
  var neg = val & 0x8000
  if (neg)
    return (0xffff - val + 1) * -1
  else
    return val
}

Buffer.prototype.readInt16LE = function (offset, noAssert) {
  return _readInt16(this, offset, true, noAssert)
}

Buffer.prototype.readInt16BE = function (offset, noAssert) {
  return _readInt16(this, offset, false, noAssert)
}

function _readInt32 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  var val = _readUInt32(buf, offset, littleEndian, true)
  var neg = val & 0x80000000
  if (neg)
    return (0xffffffff - val + 1) * -1
  else
    return val
}

Buffer.prototype.readInt32LE = function (offset, noAssert) {
  return _readInt32(this, offset, true, noAssert)
}

Buffer.prototype.readInt32BE = function (offset, noAssert) {
  return _readInt32(this, offset, false, noAssert)
}

function _readFloat (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset + 3 < buf.length, 'Trying to read beyond buffer length')
  }

  return ieee754.read(buf, offset, littleEndian, 23, 4)
}

Buffer.prototype.readFloatLE = function (offset, noAssert) {
  return _readFloat(this, offset, true, noAssert)
}

Buffer.prototype.readFloatBE = function (offset, noAssert) {
  return _readFloat(this, offset, false, noAssert)
}

function _readDouble (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset + 7 < buf.length, 'Trying to read beyond buffer length')
  }

  return ieee754.read(buf, offset, littleEndian, 52, 8)
}

Buffer.prototype.readDoubleLE = function (offset, noAssert) {
  return _readDouble(this, offset, true, noAssert)
}

Buffer.prototype.readDoubleBE = function (offset, noAssert) {
  return _readDouble(this, offset, false, noAssert)
}

Buffer.prototype.writeUInt8 = function (value, offset, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset < this.length, 'trying to write beyond buffer length')
    verifuint(value, 0xff)
  }

  if (offset >= this.length) return

  this[offset] = value
}

function _writeUInt16 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'trying to write beyond buffer length')
    verifuint(value, 0xffff)
  }

  var len = buf.length
  if (offset >= len)
    return

  for (var i = 0, j = Math.min(len - offset, 2); i < j; i++) {
    buf[offset + i] =
        (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
            (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function (value, offset, noAssert) {
  _writeUInt16(this, value, offset, true, noAssert)
}

Buffer.prototype.writeUInt16BE = function (value, offset, noAssert) {
  _writeUInt16(this, value, offset, false, noAssert)
}

function _writeUInt32 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'trying to write beyond buffer length')
    verifuint(value, 0xffffffff)
  }

  var len = buf.length
  if (offset >= len)
    return

  for (var i = 0, j = Math.min(len - offset, 4); i < j; i++) {
    buf[offset + i] =
        (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function (value, offset, noAssert) {
  _writeUInt32(this, value, offset, true, noAssert)
}

Buffer.prototype.writeUInt32BE = function (value, offset, noAssert) {
  _writeUInt32(this, value, offset, false, noAssert)
}

Buffer.prototype.writeInt8 = function (value, offset, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset < this.length, 'Trying to write beyond buffer length')
    verifsint(value, 0x7f, -0x80)
  }

  if (offset >= this.length)
    return

  if (value >= 0)
    this.writeUInt8(value, offset, noAssert)
  else
    this.writeUInt8(0xff + value + 1, offset, noAssert)
}

function _writeInt16 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'Trying to write beyond buffer length')
    verifsint(value, 0x7fff, -0x8000)
  }

  var len = buf.length
  if (offset >= len)
    return

  if (value >= 0)
    _writeUInt16(buf, value, offset, littleEndian, noAssert)
  else
    _writeUInt16(buf, 0xffff + value + 1, offset, littleEndian, noAssert)
}

Buffer.prototype.writeInt16LE = function (value, offset, noAssert) {
  _writeInt16(this, value, offset, true, noAssert)
}

Buffer.prototype.writeInt16BE = function (value, offset, noAssert) {
  _writeInt16(this, value, offset, false, noAssert)
}

function _writeInt32 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to write beyond buffer length')
    verifsint(value, 0x7fffffff, -0x80000000)
  }

  var len = buf.length
  if (offset >= len)
    return

  if (value >= 0)
    _writeUInt32(buf, value, offset, littleEndian, noAssert)
  else
    _writeUInt32(buf, 0xffffffff + value + 1, offset, littleEndian, noAssert)
}

Buffer.prototype.writeInt32LE = function (value, offset, noAssert) {
  _writeInt32(this, value, offset, true, noAssert)
}

Buffer.prototype.writeInt32BE = function (value, offset, noAssert) {
  _writeInt32(this, value, offset, false, noAssert)
}

function _writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to write beyond buffer length')
    verifIEEE754(value, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }

  var len = buf.length
  if (offset >= len)
    return

  ieee754.write(buf, value, offset, littleEndian, 23, 4)
}

Buffer.prototype.writeFloatLE = function (value, offset, noAssert) {
  _writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function (value, offset, noAssert) {
  _writeFloat(this, value, offset, false, noAssert)
}

function _writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 7 < buf.length,
        'Trying to write beyond buffer length')
    verifIEEE754(value, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }

  var len = buf.length
  if (offset >= len)
    return

  ieee754.write(buf, value, offset, littleEndian, 52, 8)
}

Buffer.prototype.writeDoubleLE = function (value, offset, noAssert) {
  _writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function (value, offset, noAssert) {
  _writeDouble(this, value, offset, false, noAssert)
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (typeof value === 'string') {
    value = value.charCodeAt(0)
  }

  assert(typeof value === 'number' && !isNaN(value), 'value is not a number')
  assert(end >= start, 'end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  assert(start >= 0 && start < this.length, 'start out of bounds')
  assert(end >= 0 && end <= this.length, 'end out of bounds')

  for (var i = start; i < end; i++) {
    this[i] = value
  }
}

Buffer.prototype.inspect = function () {
  var out = []
  var len = this.length
  for (var i = 0; i < len; i++) {
    out[i] = toHex(this[i])
    if (i === exports.INSPECT_MAX_BYTES) {
      out[i + 1] = '...'
      break
    }
  }
  return '<Buffer ' + out.join(' ') + '>'
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Only available in browsers that support ArrayBuffer.
 */
Buffer.prototype.toArrayBuffer = function () {
  if (typeof Uint8Array !== 'undefined') {
    if (Buffer._useTypedArrays) {
      return (new Buffer(this)).buffer
    } else {
      var buf = new Uint8Array(this.length)
      for (var i = 0, len = buf.length; i < len; i += 1)
        buf[i] = this[i]
      return buf.buffer
    }
  } else {
    throw new Error('Buffer.toArrayBuffer not supported in this browser')
  }
}

// HELPER FUNCTIONS
// ================

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

var BP = Buffer.prototype

/**
 * Augment a Uint8Array *instance* (not the Uint8Array class!) with Buffer methods
 */
Buffer._augment = function (arr) {
  arr._isBuffer = true

  // save reference to original Uint8Array get/set methods before overwriting
  arr._get = arr.get
  arr._set = arr.set

  // deprecated, will be removed in node 0.13+
  arr.get = BP.get
  arr.set = BP.set

  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BP.toArrayBuffer

  return arr
}

// slice(start, end)
function clamp (index, len, defaultValue) {
  if (typeof index !== 'number') return defaultValue
  index = ~~index;  // Coerce to integer.
  if (index >= len) return len
  if (index >= 0) return index
  index += len
  if (index >= 0) return index
  return 0
}

function coerce (length) {
  // Coerce length to a number (possibly NaN), round up
  // in case it's fractional (e.g. 123.456) then do a
  // double negate to coerce a NaN to 0. Easy, right?
  length = ~~Math.ceil(+length)
  return length < 0 ? 0 : length
}

function isArray (subject) {
  return (Array.isArray || function (subject) {
    return Object.prototype.toString.call(subject) === '[object Array]'
  })(subject)
}

function isArrayish (subject) {
  return isArray(subject) || Buffer.isBuffer(subject) ||
      subject && typeof subject === 'object' &&
      typeof subject.length === 'number'
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    var b = str.charCodeAt(i)
    if (b <= 0x7F)
      byteArray.push(str.charCodeAt(i))
    else {
      var start = i
      if (b >= 0xD800 && b <= 0xDFFF) i++
      var h = encodeURIComponent(str.slice(start, i+1)).substr(1).split('%')
      for (var j = 0; j < h.length; j++)
        byteArray.push(parseInt(h[j], 16))
    }
  }
  return byteArray
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(str)
}

function blitBuffer (src, dst, offset, length) {
  var pos
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length))
      break
    dst[i + offset] = src[i]
  }
  return i
}

function decodeUtf8Char (str) {
  try {
    return decodeURIComponent(str)
  } catch (err) {
    return String.fromCharCode(0xFFFD) // UTF 8 invalid char
  }
}

/*
 * We have to make sure that the value is a valid integer. This means that it
 * is non-negative. It has no fractional component and that it does not
 * exceed the maximum allowed value.
 */
function verifuint (value, max) {
  assert(typeof value === 'number', 'cannot write a non-number as a number')
  assert(value >= 0, 'specified a negative value for writing an unsigned value')
  assert(value <= max, 'value is larger than maximum value for type')
  assert(Math.floor(value) === value, 'value has a fractional component')
}

function verifsint (value, max, min) {
  assert(typeof value === 'number', 'cannot write a non-number as a number')
  assert(value <= max, 'value larger than maximum allowed value')
  assert(value >= min, 'value smaller than minimum allowed value')
  assert(Math.floor(value) === value, 'value has a fractional component')
}

function verifIEEE754 (value, max, min) {
  assert(typeof value === 'number', 'cannot write a non-number as a number')
  assert(value <= max, 'value larger than maximum allowed value')
  assert(value >= min, 'value smaller than minimum allowed value')
}

function assert (test, message) {
  if (!test) throw new Error(message || 'Failed assertion')
}

}).call(this,require("1YiZ5S"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../node_modules/gulp-browserify/node_modules/browserify/node_modules/buffer/index.js","/../node_modules/gulp-browserify/node_modules/browserify/node_modules/buffer")
},{"1YiZ5S":4,"base64-js":2,"buffer":1,"ieee754":3}],2:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

;(function (exports) {
  'use strict';

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

  var PLUS   = '+'.charCodeAt(0)
  var SLASH  = '/'.charCodeAt(0)
  var NUMBER = '0'.charCodeAt(0)
  var LOWER  = 'a'.charCodeAt(0)
  var UPPER  = 'A'.charCodeAt(0)
  var PLUS_URL_SAFE = '-'.charCodeAt(0)
  var SLASH_URL_SAFE = '_'.charCodeAt(0)

  function decode (elt) {
    var code = elt.charCodeAt(0)
    if (code === PLUS ||
        code === PLUS_URL_SAFE)
      return 62 // '+'
    if (code === SLASH ||
        code === SLASH_URL_SAFE)
      return 63 // '/'
    if (code < NUMBER)
      return -1 //no match
    if (code < NUMBER + 10)
      return code - NUMBER + 26 + 26
    if (code < UPPER + 26)
      return code - UPPER
    if (code < LOWER + 26)
      return code - LOWER + 26
  }

  function b64ToByteArray (b64) {
    var i, j, l, tmp, placeHolders, arr

    if (b64.length % 4 > 0) {
      throw new Error('Invalid string. Length must be a multiple of 4')
    }

    // the number of equal signs (place holders)
    // if there are two placeholders, than the two characters before it
    // represent one byte
    // if there is only one, then the three characters before it represent 2 bytes
    // this is just a cheap hack to not do indexOf twice
    var len = b64.length
    placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0

    // base64 is 4/3 + up to two characters of the original data
    arr = new Arr(b64.length * 3 / 4 - placeHolders)

    // if there are placeholders, only get up to the last complete 4 chars
    l = placeHolders > 0 ? b64.length - 4 : b64.length

    var L = 0

    function push (v) {
      arr[L++] = v
    }

    for (i = 0, j = 0; i < l; i += 4, j += 3) {
      tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
      push((tmp & 0xFF0000) >> 16)
      push((tmp & 0xFF00) >> 8)
      push(tmp & 0xFF)
    }

    if (placeHolders === 2) {
      tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
      push(tmp & 0xFF)
    } else if (placeHolders === 1) {
      tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
      push((tmp >> 8) & 0xFF)
      push(tmp & 0xFF)
    }

    return arr
  }

  function uint8ToBase64 (uint8) {
    var i,
      extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
      output = "",
      temp, length

    function encode (num) {
      return lookup.charAt(num)
    }

    function tripletToBase64 (num) {
      return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
    }

    // go through the array every three bytes, we'll deal with trailing stuff later
    for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
      temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
      output += tripletToBase64(temp)
    }

    // pad the end with zeros, but make sure to not forget the extra bytes
    switch (extraBytes) {
      case 1:
        temp = uint8[uint8.length - 1]
        output += encode(temp >> 2)
        output += encode((temp << 4) & 0x3F)
        output += '=='
        break
      case 2:
        temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
        output += encode(temp >> 10)
        output += encode((temp >> 4) & 0x3F)
        output += encode((temp << 2) & 0x3F)
        output += '='
        break
    }

    return output
  }

  exports.toByteArray = b64ToByteArray
  exports.fromByteArray = uint8ToBase64
}(typeof exports === 'undefined' ? (this.base64js = {}) : exports))

}).call(this,require("1YiZ5S"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../node_modules/gulp-browserify/node_modules/browserify/node_modules/buffer/node_modules/base64-js/lib/b64.js","/../node_modules/gulp-browserify/node_modules/browserify/node_modules/buffer/node_modules/base64-js/lib")
},{"1YiZ5S":4,"buffer":1}],3:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
exports.read = function(buffer, offset, isLE, mLen, nBytes) {
  var e, m,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      nBits = -7,
      i = isLE ? (nBytes - 1) : 0,
      d = isLE ? -1 : 1,
      s = buffer[offset + i];

  i += d;

  e = s & ((1 << (-nBits)) - 1);
  s >>= (-nBits);
  nBits += eLen;
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8);

  m = e & ((1 << (-nBits)) - 1);
  e >>= (-nBits);
  nBits += mLen;
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8);

  if (e === 0) {
    e = 1 - eBias;
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity);
  } else {
    m = m + Math.pow(2, mLen);
    e = e - eBias;
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
};

exports.write = function(buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0),
      i = isLE ? 0 : (nBytes - 1),
      d = isLE ? 1 : -1,
      s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0;

  value = Math.abs(value);

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0;
    e = eMax;
  } else {
    e = Math.floor(Math.log(value) / Math.LN2);
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--;
      c *= 2;
    }
    if (e + eBias >= 1) {
      value += rt / c;
    } else {
      value += rt * Math.pow(2, 1 - eBias);
    }
    if (value * c >= 2) {
      e++;
      c /= 2;
    }

    if (e + eBias >= eMax) {
      m = 0;
      e = eMax;
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen);
      e = e + eBias;
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
      e = 0;
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8);

  e = (e << mLen) | m;
  eLen += mLen;
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8);

  buffer[offset + i - d] |= s * 128;
};

}).call(this,require("1YiZ5S"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../node_modules/gulp-browserify/node_modules/browserify/node_modules/buffer/node_modules/ieee754/index.js","/../node_modules/gulp-browserify/node_modules/browserify/node_modules/buffer/node_modules/ieee754")
},{"1YiZ5S":4,"buffer":1}],4:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
// shim for using process in browser

var process = module.exports = {};

process.nextTick = (function () {
    var canSetImmediate = typeof window !== 'undefined'
    && window.setImmediate;
    var canPost = typeof window !== 'undefined'
    && window.postMessage && window.addEventListener
    ;

    if (canSetImmediate) {
        return function (f) { return window.setImmediate(f) };
    }

    if (canPost) {
        var queue = [];
        window.addEventListener('message', function (ev) {
            var source = ev.source;
            if ((source === window || source === null) && ev.data === 'process-tick') {
                ev.stopPropagation();
                if (queue.length > 0) {
                    var fn = queue.shift();
                    fn();
                }
            }
        }, true);

        return function nextTick(fn) {
            queue.push(fn);
            window.postMessage('process-tick', '*');
        };
    }

    return function nextTick(fn) {
        setTimeout(fn, 0);
    };
})();

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
}

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};

}).call(this,require("1YiZ5S"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../node_modules/gulp-browserify/node_modules/browserify/node_modules/process/browser.js","/../node_modules/gulp-browserify/node_modules/browserify/node_modules/process")
},{"1YiZ5S":4,"buffer":1}],5:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
// three.js / threejs.org/license
THREE = {
    REVISION: "68dev"
};
"object" === typeof module && (module.exports = THREE);
THREE.CullFaceNone = 0;
THREE.CullFaceBack = 1;
THREE.CullFaceFront = 2;
THREE.CullFaceFrontBack = 3;
THREE.FrontFaceDirectionCW = 0;
THREE.FrontFaceDirectionCCW = 1;
THREE.BasicShadowMap = 0;
THREE.PCFShadowMap = 1;
THREE.PCFSoftShadowMap = 2;
THREE.FrontSide = 0;
THREE.BackSide = 1;
THREE.DoubleSide = 2;
THREE.NoShading = 0;
THREE.FlatShading = 1;
THREE.SmoothShading = 2;
THREE.NoColors = 0;
THREE.FaceColors = 1;
THREE.VertexColors = 2;
THREE.NoBlending = 0;
THREE.NormalBlending = 1;
THREE.AdditiveBlending = 2;
THREE.SubtractiveBlending = 3;
THREE.MultiplyBlending = 4;
THREE.CustomBlending = 5;
THREE.AddEquation = 100;
THREE.SubtractEquation = 101;
THREE.ReverseSubtractEquation = 102;
THREE.ZeroFactor = 200;
THREE.OneFactor = 201;
THREE.SrcColorFactor = 202;
THREE.OneMinusSrcColorFactor = 203;
THREE.SrcAlphaFactor = 204;
THREE.OneMinusSrcAlphaFactor = 205;
THREE.DstAlphaFactor = 206;
THREE.OneMinusDstAlphaFactor = 207;
THREE.DstColorFactor = 208;
THREE.OneMinusDstColorFactor = 209;
THREE.SrcAlphaSaturateFactor = 210;
THREE.MultiplyOperation = 0;
THREE.MixOperation = 1;
THREE.AddOperation = 2;
THREE.UVMapping = function() {};
THREE.CubeReflectionMapping = function() {};
THREE.CubeRefractionMapping = function() {};
THREE.SphericalReflectionMapping = function() {};
THREE.SphericalRefractionMapping = function() {};
THREE.RepeatWrapping = 1E3;
THREE.ClampToEdgeWrapping = 1001;
THREE.MirroredRepeatWrapping = 1002;
THREE.NearestFilter = 1003;
THREE.NearestMipMapNearestFilter = 1004;
THREE.NearestMipMapLinearFilter = 1005;
THREE.LinearFilter = 1006;
THREE.LinearMipMapNearestFilter = 1007;
THREE.LinearMipMapLinearFilter = 1008;
THREE.UnsignedByteType = 1009;
THREE.ByteType = 1010;
THREE.ShortType = 1011;
THREE.UnsignedShortType = 1012;
THREE.IntType = 1013;
THREE.UnsignedIntType = 1014;
THREE.FloatType = 1015;
THREE.UnsignedShort4444Type = 1016;
THREE.UnsignedShort5551Type = 1017;
THREE.UnsignedShort565Type = 1018;
THREE.AlphaFormat = 1019;
THREE.RGBFormat = 1020;
THREE.RGBAFormat = 1021;
THREE.LuminanceFormat = 1022;
THREE.LuminanceAlphaFormat = 1023;
THREE.RGB_S3TC_DXT1_Format = 2001;
THREE.RGBA_S3TC_DXT1_Format = 2002;
THREE.RGBA_S3TC_DXT3_Format = 2003;
THREE.RGBA_S3TC_DXT5_Format = 2004;
THREE.Color = function(a) {
    return 3 === arguments.length ? this.setRGB(arguments[0], arguments[1], arguments[2]) : this.set(a)
};
THREE.Color.prototype = {
    constructor: THREE.Color,
    r: 1,
    g: 1,
    b: 1,
    set: function(a) {
        a instanceof THREE.Color ? this.copy(a) : "number" === typeof a ? this.setHex(a) : "string" === typeof a && this.setStyle(a);
        return this
    },
    setHex: function(a) {
        a = Math.floor(a);
        this.r = (a >> 16 & 255) / 255;
        this.g = (a >> 8 & 255) / 255;
        this.b = (a & 255) / 255;
        return this
    },
    setRGB: function(a, b, c) {
        this.r = a;
        this.g = b;
        this.b = c;
        return this
    },
    setHSL: function(a, b, c) {
        if (0 === b) this.r = this.g = this.b = c;
        else {
            var d = function(a, b, c) {
                0 > c && (c += 1);
                1 < c && (c -= 1);
                return c < 1 / 6 ? a + 6 * (b - a) *
                    c : 0.5 > c ? b : c < 2 / 3 ? a + 6 * (b - a) * (2 / 3 - c) : a
            };
            b = 0.5 >= c ? c * (1 + b) : c + b - c * b;
            c = 2 * c - b;
            this.r = d(c, b, a + 1 / 3);
            this.g = d(c, b, a);
            this.b = d(c, b, a - 1 / 3)
        }
        return this
    },
    setStyle: function(a) {
        if (/^rgb\((\d+), ?(\d+), ?(\d+)\)$/i.test(a)) return a = /^rgb\((\d+), ?(\d+), ?(\d+)\)$/i.exec(a), this.r = Math.min(255, parseInt(a[1], 10)) / 255, this.g = Math.min(255, parseInt(a[2], 10)) / 255, this.b = Math.min(255, parseInt(a[3], 10)) / 255, this;
        if (/^rgb\((\d+)\%, ?(\d+)\%, ?(\d+)\%\)$/i.test(a)) return a = /^rgb\((\d+)\%, ?(\d+)\%, ?(\d+)\%\)$/i.exec(a), this.r =
            Math.min(100, parseInt(a[1], 10)) / 100, this.g = Math.min(100, parseInt(a[2], 10)) / 100, this.b = Math.min(100, parseInt(a[3], 10)) / 100, this;
        if (/^\#([0-9a-f]{6})$/i.test(a)) return a = /^\#([0-9a-f]{6})$/i.exec(a), this.setHex(parseInt(a[1], 16)), this;
        if (/^\#([0-9a-f])([0-9a-f])([0-9a-f])$/i.test(a)) return a = /^\#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(a), this.setHex(parseInt(a[1] + a[1] + a[2] + a[2] + a[3] + a[3], 16)), this;
        if (/^(\w+)$/i.test(a)) return this.setHex(THREE.ColorKeywords[a]), this
    },
    copy: function(a) {
        this.r = a.r;
        this.g =
            a.g;
        this.b = a.b;
        return this
    },
    copyGammaToLinear: function(a) {
        this.r = a.r * a.r;
        this.g = a.g * a.g;
        this.b = a.b * a.b;
        return this
    },
    copyLinearToGamma: function(a) {
        this.r = Math.sqrt(a.r);
        this.g = Math.sqrt(a.g);
        this.b = Math.sqrt(a.b);
        return this
    },
    convertGammaToLinear: function() {
        var a = this.r,
            b = this.g,
            c = this.b;
        this.r = a * a;
        this.g = b * b;
        this.b = c * c;
        return this
    },
    convertLinearToGamma: function() {
        this.r = Math.sqrt(this.r);
        this.g = Math.sqrt(this.g);
        this.b = Math.sqrt(this.b);
        return this
    },
    getHex: function() {
        return 255 * this.r << 16 ^ 255 * this.g <<
            8 ^ 255 * this.b << 0
    },
    getHexString: function() {
        return ("000000" + this.getHex().toString(16)).slice(-6)
    },
    getHSL: function(a) {
        a = a || {
            h: 0,
            s: 0,
            l: 0
        };
        var b = this.r,
            c = this.g,
            d = this.b,
            e = Math.max(b, c, d),
            f = Math.min(b, c, d),
            g, h = (f + e) / 2;
        if (f === e) f = g = 0;
        else {
            var k = e - f,
                f = 0.5 >= h ? k / (e + f) : k / (2 - e - f);
            switch (e) {
                case b:
                    g = (c - d) / k + (c < d ? 6 : 0);
                    break;
                case c:
                    g = (d - b) / k + 2;
                    break;
                case d:
                    g = (b - c) / k + 4
            }
            g /= 6
        }
        a.h = g;
        a.s = f;
        a.l = h;
        return a
    },
    getStyle: function() {
        return "rgb(" + (255 * this.r | 0) + "," + (255 * this.g | 0) + "," + (255 * this.b | 0) + ")"
    },
    offsetHSL: function(a,
        b, c) {
        var d = this.getHSL();
        d.h += a;
        d.s += b;
        d.l += c;
        this.setHSL(d.h, d.s, d.l);
        return this
    },
    add: function(a) {
        this.r += a.r;
        this.g += a.g;
        this.b += a.b;
        return this
    },
    addColors: function(a, b) {
        this.r = a.r + b.r;
        this.g = a.g + b.g;
        this.b = a.b + b.b;
        return this
    },
    addScalar: function(a) {
        this.r += a;
        this.g += a;
        this.b += a;
        return this
    },
    multiply: function(a) {
        this.r *= a.r;
        this.g *= a.g;
        this.b *= a.b;
        return this
    },
    multiplyScalar: function(a) {
        this.r *= a;
        this.g *= a;
        this.b *= a;
        return this
    },
    lerp: function(a, b) {
        this.r += (a.r - this.r) * b;
        this.g += (a.g - this.g) * b;
        this.b += (a.b - this.b) * b;
        return this
    },
    equals: function(a) {
        return a.r === this.r && a.g === this.g && a.b === this.b
    },
    fromArray: function(a) {
        this.r = a[0];
        this.g = a[1];
        this.b = a[2];
        return this
    },
    toArray: function() {
        return [this.r, this.g, this.b]
    },
    clone: function() {
        return (new THREE.Color).setRGB(this.r, this.g, this.b)
    }
};
THREE.ColorKeywords = {
    aliceblue: 15792383,
    antiquewhite: 16444375,
    aqua: 65535,
    aquamarine: 8388564,
    azure: 15794175,
    beige: 16119260,
    bisque: 16770244,
    black: 0,
    blanchedalmond: 16772045,
    blue: 255,
    blueviolet: 9055202,
    brown: 10824234,
    burlywood: 14596231,
    cadetblue: 6266528,
    chartreuse: 8388352,
    chocolate: 13789470,
    coral: 16744272,
    cornflowerblue: 6591981,
    cornsilk: 16775388,
    crimson: 14423100,
    cyan: 65535,
    darkblue: 139,
    darkcyan: 35723,
    darkgoldenrod: 12092939,
    darkgray: 11119017,
    darkgreen: 25600,
    darkgrey: 11119017,
    darkkhaki: 12433259,
    darkmagenta: 9109643,
    darkolivegreen: 5597999,
    darkorange: 16747520,
    darkorchid: 10040012,
    darkred: 9109504,
    darksalmon: 15308410,
    darkseagreen: 9419919,
    darkslateblue: 4734347,
    darkslategray: 3100495,
    darkslategrey: 3100495,
    darkturquoise: 52945,
    darkviolet: 9699539,
    deeppink: 16716947,
    deepskyblue: 49151,
    dimgray: 6908265,
    dimgrey: 6908265,
    dodgerblue: 2003199,
    firebrick: 11674146,
    floralwhite: 16775920,
    forestgreen: 2263842,
    fuchsia: 16711935,
    gainsboro: 14474460,
    ghostwhite: 16316671,
    gold: 16766720,
    goldenrod: 14329120,
    gray: 8421504,
    green: 32768,
    greenyellow: 11403055,
    grey: 8421504,
    honeydew: 15794160,
    hotpink: 16738740,
    indianred: 13458524,
    indigo: 4915330,
    ivory: 16777200,
    khaki: 15787660,
    lavender: 15132410,
    lavenderblush: 16773365,
    lawngreen: 8190976,
    lemonchiffon: 16775885,
    lightblue: 11393254,
    lightcoral: 15761536,
    lightcyan: 14745599,
    lightgoldenrodyellow: 16448210,
    lightgray: 13882323,
    lightgreen: 9498256,
    lightgrey: 13882323,
    lightpink: 16758465,
    lightsalmon: 16752762,
    lightseagreen: 2142890,
    lightskyblue: 8900346,
    lightslategray: 7833753,
    lightslategrey: 7833753,
    lightsteelblue: 11584734,
    lightyellow: 16777184,
    lime: 65280,
    limegreen: 3329330,
    linen: 16445670,
    magenta: 16711935,
    maroon: 8388608,
    mediumaquamarine: 6737322,
    mediumblue: 205,
    mediumorchid: 12211667,
    mediumpurple: 9662683,
    mediumseagreen: 3978097,
    mediumslateblue: 8087790,
    mediumspringgreen: 64154,
    mediumturquoise: 4772300,
    mediumvioletred: 13047173,
    midnightblue: 1644912,
    mintcream: 16121850,
    mistyrose: 16770273,
    moccasin: 16770229,
    navajowhite: 16768685,
    navy: 128,
    oldlace: 16643558,
    olive: 8421376,
    olivedrab: 7048739,
    orange: 16753920,
    orangered: 16729344,
    orchid: 14315734,
    palegoldenrod: 15657130,
    palegreen: 10025880,
    paleturquoise: 11529966,
    palevioletred: 14381203,
    papayawhip: 16773077,
    peachpuff: 16767673,
    peru: 13468991,
    pink: 16761035,
    plum: 14524637,
    powderblue: 11591910,
    purple: 8388736,
    red: 16711680,
    rosybrown: 12357519,
    royalblue: 4286945,
    saddlebrown: 9127187,
    salmon: 16416882,
    sandybrown: 16032864,
    seagreen: 3050327,
    seashell: 16774638,
    sienna: 10506797,
    silver: 12632256,
    skyblue: 8900331,
    slateblue: 6970061,
    slategray: 7372944,
    slategrey: 7372944,
    snow: 16775930,
    springgreen: 65407,
    steelblue: 4620980,
    tan: 13808780,
    teal: 32896,
    thistle: 14204888,
    tomato: 16737095,
    turquoise: 4251856,
    violet: 15631086,
    wheat: 16113331,
    white: 16777215,
    whitesmoke: 16119285,
    yellow: 16776960,
    yellowgreen: 10145074
};
THREE.Quaternion = function(a, b, c, d) {
    this._x = a || 0;
    this._y = b || 0;
    this._z = c || 0;
    this._w = void 0 !== d ? d : 1
};
THREE.Quaternion.prototype = {
    constructor: THREE.Quaternion,
    _x: 0,
    _y: 0,
    _z: 0,
    _w: 0,
    get x() {
        return this._x
    },
    set x(a) {
        this._x = a;
        this.onChangeCallback()
    },
    get y() {
        return this._y
    },
    set y(a) {
        this._y = a;
        this.onChangeCallback()
    },
    get z() {
        return this._z
    },
    set z(a) {
        this._z = a;
        this.onChangeCallback()
    },
    get w() {
        return this._w
    },
    set w(a) {
        this._w = a;
        this.onChangeCallback()
    },
    set: function(a, b, c, d) {
        this._x = a;
        this._y = b;
        this._z = c;
        this._w = d;
        this.onChangeCallback();
        return this
    },
    copy: function(a) {
        this._x = a.x;
        this._y = a.y;
        this._z = a.z;
        this._w = a.w;
        this.onChangeCallback();
        return this
    },
    setFromEuler: function(a, b) {
        if (!1 === a instanceof THREE.Euler) throw Error("THREE.Quaternion: .setFromEuler() now expects a Euler rotation rather than a Vector3 and order.");
        var c = Math.cos(a._x / 2),
            d = Math.cos(a._y / 2),
            e = Math.cos(a._z / 2),
            f = Math.sin(a._x / 2),
            g = Math.sin(a._y / 2),
            h = Math.sin(a._z / 2);
        "XYZ" === a.order ? (this._x = f * d * e + c * g * h, this._y = c * g * e - f * d * h, this._z = c * d * h + f * g * e, this._w = c * d * e - f * g * h) : "YXZ" === a.order ? (this._x = f * d * e + c * g * h, this._y = c * g * e - f * d * h, this._z =
            c * d * h - f * g * e, this._w = c * d * e + f * g * h) : "ZXY" === a.order ? (this._x = f * d * e - c * g * h, this._y = c * g * e + f * d * h, this._z = c * d * h + f * g * e, this._w = c * d * e - f * g * h) : "ZYX" === a.order ? (this._x = f * d * e - c * g * h, this._y = c * g * e + f * d * h, this._z = c * d * h - f * g * e, this._w = c * d * e + f * g * h) : "YZX" === a.order ? (this._x = f * d * e + c * g * h, this._y = c * g * e + f * d * h, this._z = c * d * h - f * g * e, this._w = c * d * e - f * g * h) : "XZY" === a.order && (this._x = f * d * e - c * g * h, this._y = c * g * e - f * d * h, this._z = c * d * h + f * g * e, this._w = c * d * e + f * g * h);
        if (!1 !== b) this.onChangeCallback();
        return this
    },
    setFromAxisAngle: function(a,
        b) {
        var c = b / 2,
            d = Math.sin(c);
        this._x = a.x * d;
        this._y = a.y * d;
        this._z = a.z * d;
        this._w = Math.cos(c);
        this.onChangeCallback();
        return this
    },
    setFromRotationMatrix: function(a) {
        var b = a.elements,
            c = b[0];
        a = b[4];
        var d = b[8],
            e = b[1],
            f = b[5],
            g = b[9],
            h = b[2],
            k = b[6],
            b = b[10],
            l = c + f + b;
        0 < l ? (c = 0.5 / Math.sqrt(l + 1), this._w = 0.25 / c, this._x = (k - g) * c, this._y = (d - h) * c, this._z = (e - a) * c) : c > f && c > b ? (c = 2 * Math.sqrt(1 + c - f - b), this._w = (k - g) / c, this._x = 0.25 * c, this._y = (a + e) / c, this._z = (d + h) / c) : f > b ? (c = 2 * Math.sqrt(1 + f - c - b), this._w = (d - h) / c, this._x = (a + e) / c, this._y =
            0.25 * c, this._z = (g + k) / c) : (c = 2 * Math.sqrt(1 + b - c - f), this._w = (e - a) / c, this._x = (d + h) / c, this._y = (g + k) / c, this._z = 0.25 * c);
        this.onChangeCallback();
        return this
    },
    setFromUnitVectors: function() {
        var a, b;
        return function(c, d) {
            void 0 === a && (a = new THREE.Vector3);
            b = c.dot(d) + 1;
            1E-6 > b ? (b = 0, Math.abs(c.x) > Math.abs(c.z) ? a.set(-c.y, c.x, 0) : a.set(0, -c.z, c.y)) : a.crossVectors(c, d);
            this._x = a.x;
            this._y = a.y;
            this._z = a.z;
            this._w = b;
            this.normalize();
            return this
        }
    }(),
    inverse: function() {
        this.conjugate().normalize();
        return this
    },
    conjugate: function() {
        this._x *=
            -1;
        this._y *= -1;
        this._z *= -1;
        this.onChangeCallback();
        return this
    },
    dot: function(a) {
        return this._x * a._x + this._y * a._y + this._z * a._z + this._w * a._w
    },
    lengthSq: function() {
        return this._x * this._x + this._y * this._y + this._z * this._z + this._w * this._w
    },
    length: function() {
        return Math.sqrt(this._x * this._x + this._y * this._y + this._z * this._z + this._w * this._w)
    },
    normalize: function() {
        var a = this.length();
        0 === a ? (this._z = this._y = this._x = 0, this._w = 1) : (a = 1 / a, this._x *= a, this._y *= a, this._z *= a, this._w *= a);
        this.onChangeCallback();
        return this
    },
    multiply: function(a, b) {
        return void 0 !== b ? (console.warn("THREE.Quaternion: .multiply() now only accepts one argument. Use .multiplyQuaternions( a, b ) instead."), this.multiplyQuaternions(a, b)) : this.multiplyQuaternions(this, a)
    },
    multiplyQuaternions: function(a, b) {
        var c = a._x,
            d = a._y,
            e = a._z,
            f = a._w,
            g = b._x,
            h = b._y,
            k = b._z,
            l = b._w;
        this._x = c * l + f * g + d * k - e * h;
        this._y = d * l + f * h + e * g - c * k;
        this._z = e * l + f * k + c * h - d * g;
        this._w = f * l - c * g - d * h - e * k;
        this.onChangeCallback();
        return this
    },
    multiplyVector3: function(a) {
        console.warn("THREE.Quaternion: .multiplyVector3() has been removed. Use is now vector.applyQuaternion( quaternion ) instead.");
        return a.applyQuaternion(this)
    },
    slerp: function(a, b) {
        var c = this._x,
            d = this._y,
            e = this._z,
            f = this._w,
            g = f * a._w + c * a._x + d * a._y + e * a._z;
        0 > g ? (this._w = -a._w, this._x = -a._x, this._y = -a._y, this._z = -a._z, g = -g) : this.copy(a);
        if (1 <= g) return this._w = f, this._x = c, this._y = d, this._z = e, this;
        var h = Math.acos(g),
            k = Math.sqrt(1 - g * g);
        if (0.001 > Math.abs(k)) return this._w = 0.5 * (f + this._w), this._x = 0.5 * (c + this._x), this._y = 0.5 * (d + this._y), this._z = 0.5 * (e + this._z), this;
        g = Math.sin((1 - b) * h) / k;
        h = Math.sin(b * h) / k;
        this._w = f * g + this._w * h;
        this._x =
            c * g + this._x * h;
        this._y = d * g + this._y * h;
        this._z = e * g + this._z * h;
        this.onChangeCallback();
        return this
    },
    equals: function(a) {
        return a._x === this._x && a._y === this._y && a._z === this._z && a._w === this._w
    },
    fromArray: function(a) {
        this._x = a[0];
        this._y = a[1];
        this._z = a[2];
        this._w = a[3];
        this.onChangeCallback();
        return this
    },
    toArray: function() {
        return [this._x, this._y, this._z, this._w]
    },
    onChange: function(a) {
        this.onChangeCallback = a;
        return this
    },
    onChangeCallback: function() {},
    clone: function() {
        return new THREE.Quaternion(this._x, this._y,
            this._z, this._w)
    }
};
THREE.Quaternion.slerp = function(a, b, c, d) {
    return c.copy(a).slerp(b, d)
};
THREE.Vector2 = function(a, b) {
    this.x = a || 0;
    this.y = b || 0
};
THREE.Vector2.prototype = {
    constructor: THREE.Vector2,
    set: function(a, b) {
        this.x = a;
        this.y = b;
        return this
    },
    setX: function(a) {
        this.x = a;
        return this
    },
    setY: function(a) {
        this.y = a;
        return this
    },
    setComponent: function(a, b) {
        switch (a) {
            case 0:
                this.x = b;
                break;
            case 1:
                this.y = b;
                break;
            default:
                throw Error("index is out of range: " + a);
        }
    },
    getComponent: function(a) {
        switch (a) {
            case 0:
                return this.x;
            case 1:
                return this.y;
            default:
                throw Error("index is out of range: " + a);
        }
    },
    copy: function(a) {
        this.x = a.x;
        this.y = a.y;
        return this
    },
    add: function(a,
        b) {
        if (void 0 !== b) return console.warn("THREE.Vector2: .add() now only accepts one argument. Use .addVectors( a, b ) instead."), this.addVectors(a, b);
        this.x += a.x;
        this.y += a.y;
        return this
    },
    addVectors: function(a, b) {
        this.x = a.x + b.x;
        this.y = a.y + b.y;
        return this
    },
    addScalar: function(a) {
        this.x += a;
        this.y += a;
        return this
    },
    sub: function(a, b) {
        if (void 0 !== b) return console.warn("THREE.Vector2: .sub() now only accepts one argument. Use .subVectors( a, b ) instead."), this.subVectors(a, b);
        this.x -= a.x;
        this.y -= a.y;
        return this
    },
    subVectors: function(a, b) {
        this.x = a.x - b.x;
        this.y = a.y - b.y;
        return this
    },
    multiply: function(a) {
        this.x *= a.x;
        this.y *= a.y;
        return this
    },
    multiplyScalar: function(a) {
        this.x *= a;
        this.y *= a;
        return this
    },
    divide: function(a) {
        this.x /= a.x;
        this.y /= a.y;
        return this
    },
    divideScalar: function(a) {
        0 !== a ? (a = 1 / a, this.x *= a, this.y *= a) : this.y = this.x = 0;
        return this
    },
    min: function(a) {
        this.x > a.x && (this.x = a.x);
        this.y > a.y && (this.y = a.y);
        return this
    },
    max: function(a) {
        this.x < a.x && (this.x = a.x);
        this.y < a.y && (this.y = a.y);
        return this
    },
    clamp: function(a,
        b) {
        this.x < a.x ? this.x = a.x : this.x > b.x && (this.x = b.x);
        this.y < a.y ? this.y = a.y : this.y > b.y && (this.y = b.y);
        return this
    },
    clampScalar: function() {
        var a, b;
        return function(c, d) {
            void 0 === a && (a = new THREE.Vector2, b = new THREE.Vector2);
            a.set(c, c);
            b.set(d, d);
            return this.clamp(a, b)
        }
    }(),
    floor: function() {
        this.x = Math.floor(this.x);
        this.y = Math.floor(this.y);
        return this
    },
    ceil: function() {
        this.x = Math.ceil(this.x);
        this.y = Math.ceil(this.y);
        return this
    },
    round: function() {
        this.x = Math.round(this.x);
        this.y = Math.round(this.y);
        return this
    },
    roundToZero: function() {
        this.x = 0 > this.x ? Math.ceil(this.x) : Math.floor(this.x);
        this.y = 0 > this.y ? Math.ceil(this.y) : Math.floor(this.y);
        return this
    },
    negate: function() {
        return this.multiplyScalar(-1)
    },
    dot: function(a) {
        return this.x * a.x + this.y * a.y
    },
    lengthSq: function() {
        return this.x * this.x + this.y * this.y
    },
    length: function() {
        return Math.sqrt(this.x * this.x + this.y * this.y)
    },
    normalize: function() {
        return this.divideScalar(this.length())
    },
    distanceTo: function(a) {
        return Math.sqrt(this.distanceToSquared(a))
    },
    distanceToSquared: function(a) {
        var b =
            this.x - a.x;
        a = this.y - a.y;
        return b * b + a * a
    },
    setLength: function(a) {
        var b = this.length();
        0 !== b && a !== b && this.multiplyScalar(a / b);
        return this
    },
    lerp: function(a, b) {
        this.x += (a.x - this.x) * b;
        this.y += (a.y - this.y) * b;
        return this
    },
    equals: function(a) {
        return a.x === this.x && a.y === this.y
    },
    fromArray: function(a) {
        this.x = a[0];
        this.y = a[1];
        return this
    },
    toArray: function() {
        return [this.x, this.y]
    },
    clone: function() {
        return new THREE.Vector2(this.x, this.y)
    }
};
THREE.Vector3 = function(a, b, c) {
    this.x = a || 0;
    this.y = b || 0;
    this.z = c || 0
};
THREE.Vector3.prototype = {
    constructor: THREE.Vector3,
    set: function(a, b, c) {
        this.x = a;
        this.y = b;
        this.z = c;
        return this
    },
    setX: function(a) {
        this.x = a;
        return this
    },
    setY: function(a) {
        this.y = a;
        return this
    },
    setZ: function(a) {
        this.z = a;
        return this
    },
    setComponent: function(a, b) {
        switch (a) {
            case 0:
                this.x = b;
                break;
            case 1:
                this.y = b;
                break;
            case 2:
                this.z = b;
                break;
            default:
                throw Error("index is out of range: " + a);
        }
    },
    getComponent: function(a) {
        switch (a) {
            case 0:
                return this.x;
            case 1:
                return this.y;
            case 2:
                return this.z;
            default:
                throw Error("index is out of range: " +
                    a);
        }
    },
    copy: function(a) {
        this.x = a.x;
        this.y = a.y;
        this.z = a.z;
        return this
    },
    add: function(a, b) {
        if (void 0 !== b) return console.warn("THREE.Vector3: .add() now only accepts one argument. Use .addVectors( a, b ) instead."), this.addVectors(a, b);
        this.x += a.x;
        this.y += a.y;
        this.z += a.z;
        return this
    },
    addScalar: function(a) {
        this.x += a;
        this.y += a;
        this.z += a;
        return this
    },
    addVectors: function(a, b) {
        this.x = a.x + b.x;
        this.y = a.y + b.y;
        this.z = a.z + b.z;
        return this
    },
    sub: function(a, b) {
        if (void 0 !== b) return console.warn("THREE.Vector3: .sub() now only accepts one argument. Use .subVectors( a, b ) instead."),
            this.subVectors(a, b);
        this.x -= a.x;
        this.y -= a.y;
        this.z -= a.z;
        return this
    },
    subVectors: function(a, b) {
        this.x = a.x - b.x;
        this.y = a.y - b.y;
        this.z = a.z - b.z;
        return this
    },
    multiply: function(a, b) {
        if (void 0 !== b) return console.warn("THREE.Vector3: .multiply() now only accepts one argument. Use .multiplyVectors( a, b ) instead."), this.multiplyVectors(a, b);
        this.x *= a.x;
        this.y *= a.y;
        this.z *= a.z;
        return this
    },
    multiplyScalar: function(a) {
        this.x *= a;
        this.y *= a;
        this.z *= a;
        return this
    },
    multiplyVectors: function(a, b) {
        this.x = a.x * b.x;
        this.y =
            a.y * b.y;
        this.z = a.z * b.z;
        return this
    },
    applyEuler: function() {
        var a;
        return function(b) {
            !1 === b instanceof THREE.Euler && console.error("THREE.Vector3: .applyEuler() now expects a Euler rotation rather than a Vector3 and order.");
            void 0 === a && (a = new THREE.Quaternion);
            this.applyQuaternion(a.setFromEuler(b));
            return this
        }
    }(),
    applyAxisAngle: function() {
        var a;
        return function(b, c) {
            void 0 === a && (a = new THREE.Quaternion);
            this.applyQuaternion(a.setFromAxisAngle(b, c));
            return this
        }
    }(),
    applyMatrix3: function(a) {
        var b = this.x,
            c = this.y,
            d = this.z;
        a = a.elements;
        this.x = a[0] * b + a[3] * c + a[6] * d;
        this.y = a[1] * b + a[4] * c + a[7] * d;
        this.z = a[2] * b + a[5] * c + a[8] * d;
        return this
    },
    applyMatrix4: function(a) {
        var b = this.x,
            c = this.y,
            d = this.z;
        a = a.elements;
        this.x = a[0] * b + a[4] * c + a[8] * d + a[12];
        this.y = a[1] * b + a[5] * c + a[9] * d + a[13];
        this.z = a[2] * b + a[6] * c + a[10] * d + a[14];
        return this
    },
    applyProjection: function(a) {
        var b = this.x,
            c = this.y,
            d = this.z;
        a = a.elements;
        var e = 1 / (a[3] * b + a[7] * c + a[11] * d + a[15]);
        this.x = (a[0] * b + a[4] * c + a[8] * d + a[12]) * e;
        this.y = (a[1] * b + a[5] * c + a[9] * d + a[13]) * e;
        this.z =
            (a[2] * b + a[6] * c + a[10] * d + a[14]) * e;
        return this
    },
    applyQuaternion: function(a) {
        var b = this.x,
            c = this.y,
            d = this.z,
            e = a.x,
            f = a.y,
            g = a.z;
        a = a.w;
        var h = a * b + f * d - g * c,
            k = a * c + g * b - e * d,
            l = a * d + e * c - f * b,
            b = -e * b - f * c - g * d;
        this.x = h * a + b * -e + k * -g - l * -f;
        this.y = k * a + b * -f + l * -e - h * -g;
        this.z = l * a + b * -g + h * -f - k * -e;
        return this
    },
    transformDirection: function(a) {
        var b = this.x,
            c = this.y,
            d = this.z;
        a = a.elements;
        this.x = a[0] * b + a[4] * c + a[8] * d;
        this.y = a[1] * b + a[5] * c + a[9] * d;
        this.z = a[2] * b + a[6] * c + a[10] * d;
        this.normalize();
        return this
    },
    divide: function(a) {
        this.x /= a.x;
        this.y /= a.y;
        this.z /= a.z;
        return this
    },
    divideScalar: function(a) {
        0 !== a ? (a = 1 / a, this.x *= a, this.y *= a, this.z *= a) : this.z = this.y = this.x = 0;
        return this
    },
    min: function(a) {
        this.x > a.x && (this.x = a.x);
        this.y > a.y && (this.y = a.y);
        this.z > a.z && (this.z = a.z);
        return this
    },
    max: function(a) {
        this.x < a.x && (this.x = a.x);
        this.y < a.y && (this.y = a.y);
        this.z < a.z && (this.z = a.z);
        return this
    },
    clamp: function(a, b) {
        this.x < a.x ? this.x = a.x : this.x > b.x && (this.x = b.x);
        this.y < a.y ? this.y = a.y : this.y > b.y && (this.y = b.y);
        this.z < a.z ? this.z = a.z : this.z > b.z && (this.z =
            b.z);
        return this
    },
    clampScalar: function() {
        var a, b;
        return function(c, d) {
            void 0 === a && (a = new THREE.Vector3, b = new THREE.Vector3);
            a.set(c, c, c);
            b.set(d, d, d);
            return this.clamp(a, b)
        }
    }(),
    floor: function() {
        this.x = Math.floor(this.x);
        this.y = Math.floor(this.y);
        this.z = Math.floor(this.z);
        return this
    },
    ceil: function() {
        this.x = Math.ceil(this.x);
        this.y = Math.ceil(this.y);
        this.z = Math.ceil(this.z);
        return this
    },
    round: function() {
        this.x = Math.round(this.x);
        this.y = Math.round(this.y);
        this.z = Math.round(this.z);
        return this
    },
    roundToZero: function() {
        this.x =
            0 > this.x ? Math.ceil(this.x) : Math.floor(this.x);
        this.y = 0 > this.y ? Math.ceil(this.y) : Math.floor(this.y);
        this.z = 0 > this.z ? Math.ceil(this.z) : Math.floor(this.z);
        return this
    },
    negate: function() {
        return this.multiplyScalar(-1)
    },
    dot: function(a) {
        return this.x * a.x + this.y * a.y + this.z * a.z
    },
    lengthSq: function() {
        return this.x * this.x + this.y * this.y + this.z * this.z
    },
    length: function() {
        return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z)
    },
    lengthManhattan: function() {
        return Math.abs(this.x) + Math.abs(this.y) + Math.abs(this.z)
    },
    normalize: function() {
        return this.divideScalar(this.length())
    },
    setLength: function(a) {
        var b = this.length();
        0 !== b && a !== b && this.multiplyScalar(a / b);
        return this
    },
    lerp: function(a, b) {
        this.x += (a.x - this.x) * b;
        this.y += (a.y - this.y) * b;
        this.z += (a.z - this.z) * b;
        return this
    },
    cross: function(a, b) {
        if (void 0 !== b) return console.warn("THREE.Vector3: .cross() now only accepts one argument. Use .crossVectors( a, b ) instead."), this.crossVectors(a, b);
        var c = this.x,
            d = this.y,
            e = this.z;
        this.x = d * a.z - e * a.y;
        this.y = e * a.x - c * a.z;
        this.z =
            c * a.y - d * a.x;
        return this
    },
    crossVectors: function(a, b) {
        var c = a.x,
            d = a.y,
            e = a.z,
            f = b.x,
            g = b.y,
            h = b.z;
        this.x = d * h - e * g;
        this.y = e * f - c * h;
        this.z = c * g - d * f;
        return this
    },
    projectOnVector: function() {
        var a, b;
        return function(c) {
            void 0 === a && (a = new THREE.Vector3);
            a.copy(c).normalize();
            b = this.dot(a);
            return this.copy(a).multiplyScalar(b)
        }
    }(),
    projectOnPlane: function() {
        var a;
        return function(b) {
            void 0 === a && (a = new THREE.Vector3);
            a.copy(this).projectOnVector(b);
            return this.sub(a)
        }
    }(),
    reflect: function() {
        var a;
        return function(b) {
            void 0 ===
                a && (a = new THREE.Vector3);
            return this.sub(a.copy(b).multiplyScalar(2 * this.dot(b)))
        }
    }(),
    angleTo: function(a) {
        a = this.dot(a) / (this.length() * a.length());
        return Math.acos(THREE.Math.clamp(a, -1, 1))
    },
    distanceTo: function(a) {
        return Math.sqrt(this.distanceToSquared(a))
    },
    distanceToSquared: function(a) {
        var b = this.x - a.x,
            c = this.y - a.y;
        a = this.z - a.z;
        return b * b + c * c + a * a
    },
    setEulerFromRotationMatrix: function(a, b) {
        console.error("THREE.Vector3: .setEulerFromRotationMatrix() has been removed. Use Euler.setFromRotationMatrix() instead.")
    },
    setEulerFromQuaternion: function(a, b) {
        console.error("THREE.Vector3: .setEulerFromQuaternion() has been removed. Use Euler.setFromQuaternion() instead.")
    },
    getPositionFromMatrix: function(a) {
        console.warn("THREE.Vector3: .getPositionFromMatrix() has been renamed to .setFromMatrixPosition().");
        return this.setFromMatrixPosition(a)
    },
    getScaleFromMatrix: function(a) {
        console.warn("THREE.Vector3: .getScaleFromMatrix() has been renamed to .setFromMatrixScale().");
        return this.setFromMatrixScale(a)
    },
    getColumnFromMatrix: function(a,
        b) {
        console.warn("THREE.Vector3: .getColumnFromMatrix() has been renamed to .setFromMatrixColumn().");
        return this.setFromMatrixColumn(a, b)
    },
    setFromMatrixPosition: function(a) {
        this.x = a.elements[12];
        this.y = a.elements[13];
        this.z = a.elements[14];
        return this
    },
    setFromMatrixScale: function(a) {
        var b = this.set(a.elements[0], a.elements[1], a.elements[2]).length(),
            c = this.set(a.elements[4], a.elements[5], a.elements[6]).length();
        a = this.set(a.elements[8], a.elements[9], a.elements[10]).length();
        this.x = b;
        this.y = c;
        this.z =
            a;
        return this
    },
    setFromMatrixColumn: function(a, b) {
        var c = 4 * a,
            d = b.elements;
        this.x = d[c];
        this.y = d[c + 1];
        this.z = d[c + 2];
        return this
    },
    equals: function(a) {
        return a.x === this.x && a.y === this.y && a.z === this.z
    },
    fromArray: function(a) {
        this.x = a[0];
        this.y = a[1];
        this.z = a[2];
        return this
    },
    toArray: function() {
        return [this.x, this.y, this.z]
    },
    clone: function() {
        return new THREE.Vector3(this.x, this.y, this.z)
    }
};
THREE.Vector4 = function(a, b, c, d) {
    this.x = a || 0;
    this.y = b || 0;
    this.z = c || 0;
    this.w = void 0 !== d ? d : 1
};
THREE.Vector4.prototype = {
    constructor: THREE.Vector4,
    set: function(a, b, c, d) {
        this.x = a;
        this.y = b;
        this.z = c;
        this.w = d;
        return this
    },
    setX: function(a) {
        this.x = a;
        return this
    },
    setY: function(a) {
        this.y = a;
        return this
    },
    setZ: function(a) {
        this.z = a;
        return this
    },
    setW: function(a) {
        this.w = a;
        return this
    },
    setComponent: function(a, b) {
        switch (a) {
            case 0:
                this.x = b;
                break;
            case 1:
                this.y = b;
                break;
            case 2:
                this.z = b;
                break;
            case 3:
                this.w = b;
                break;
            default:
                throw Error("index is out of range: " + a);
        }
    },
    getComponent: function(a) {
        switch (a) {
            case 0:
                return this.x;
            case 1:
                return this.y;
            case 2:
                return this.z;
            case 3:
                return this.w;
            default:
                throw Error("index is out of range: " + a);
        }
    },
    copy: function(a) {
        this.x = a.x;
        this.y = a.y;
        this.z = a.z;
        this.w = void 0 !== a.w ? a.w : 1;
        return this
    },
    add: function(a, b) {
        if (void 0 !== b) return console.warn("THREE.Vector4: .add() now only accepts one argument. Use .addVectors( a, b ) instead."), this.addVectors(a, b);
        this.x += a.x;
        this.y += a.y;
        this.z += a.z;
        this.w += a.w;
        return this
    },
    addScalar: function(a) {
        this.x += a;
        this.y += a;
        this.z += a;
        this.w += a;
        return this
    },
    addVectors: function(a, b) {
        this.x = a.x + b.x;
        this.y = a.y + b.y;
        this.z = a.z + b.z;
        this.w = a.w + b.w;
        return this
    },
    sub: function(a, b) {
        if (void 0 !== b) return console.warn("THREE.Vector4: .sub() now only accepts one argument. Use .subVectors( a, b ) instead."), this.subVectors(a, b);
        this.x -= a.x;
        this.y -= a.y;
        this.z -= a.z;
        this.w -= a.w;
        return this
    },
    subVectors: function(a, b) {
        this.x = a.x - b.x;
        this.y = a.y - b.y;
        this.z = a.z - b.z;
        this.w = a.w - b.w;
        return this
    },
    multiplyScalar: function(a) {
        this.x *= a;
        this.y *= a;
        this.z *= a;
        this.w *= a;
        return this
    },
    applyMatrix4: function(a) {
        var b =
            this.x,
            c = this.y,
            d = this.z,
            e = this.w;
        a = a.elements;
        this.x = a[0] * b + a[4] * c + a[8] * d + a[12] * e;
        this.y = a[1] * b + a[5] * c + a[9] * d + a[13] * e;
        this.z = a[2] * b + a[6] * c + a[10] * d + a[14] * e;
        this.w = a[3] * b + a[7] * c + a[11] * d + a[15] * e;
        return this
    },
    divideScalar: function(a) {
        0 !== a ? (a = 1 / a, this.x *= a, this.y *= a, this.z *= a, this.w *= a) : (this.z = this.y = this.x = 0, this.w = 1);
        return this
    },
    setAxisAngleFromQuaternion: function(a) {
        this.w = 2 * Math.acos(a.w);
        var b = Math.sqrt(1 - a.w * a.w);
        1E-4 > b ? (this.x = 1, this.z = this.y = 0) : (this.x = a.x / b, this.y = a.y / b, this.z = a.z / b);
        return this
    },
    setAxisAngleFromRotationMatrix: function(a) {
        var b, c, d;
        a = a.elements;
        var e = a[0];
        d = a[4];
        var f = a[8],
            g = a[1],
            h = a[5],
            k = a[9];
        c = a[2];
        b = a[6];
        var l = a[10];
        if (0.01 > Math.abs(d - g) && 0.01 > Math.abs(f - c) && 0.01 > Math.abs(k - b)) {
            if (0.1 > Math.abs(d + g) && 0.1 > Math.abs(f + c) && 0.1 > Math.abs(k + b) && 0.1 > Math.abs(e + h + l - 3)) return this.set(1, 0, 0, 0), this;
            a = Math.PI;
            e = (e + 1) / 2;
            h = (h + 1) / 2;
            l = (l + 1) / 2;
            d = (d + g) / 4;
            f = (f + c) / 4;
            k = (k + b) / 4;
            e > h && e > l ? 0.01 > e ? (b = 0, d = c = 0.707106781) : (b = Math.sqrt(e), c = d / b, d = f / b) : h > l ? 0.01 > h ? (b = 0.707106781, c = 0, d = 0.707106781) : (c =
                Math.sqrt(h), b = d / c, d = k / c) : 0.01 > l ? (c = b = 0.707106781, d = 0) : (d = Math.sqrt(l), b = f / d, c = k / d);
            this.set(b, c, d, a);
            return this
        }
        a = Math.sqrt((b - k) * (b - k) + (f - c) * (f - c) + (g - d) * (g - d));
        0.001 > Math.abs(a) && (a = 1);
        this.x = (b - k) / a;
        this.y = (f - c) / a;
        this.z = (g - d) / a;
        this.w = Math.acos((e + h + l - 1) / 2);
        return this
    },
    min: function(a) {
        this.x > a.x && (this.x = a.x);
        this.y > a.y && (this.y = a.y);
        this.z > a.z && (this.z = a.z);
        this.w > a.w && (this.w = a.w);
        return this
    },
    max: function(a) {
        this.x < a.x && (this.x = a.x);
        this.y < a.y && (this.y = a.y);
        this.z < a.z && (this.z = a.z);
        this.w <
            a.w && (this.w = a.w);
        return this
    },
    clamp: function(a, b) {
        this.x < a.x ? this.x = a.x : this.x > b.x && (this.x = b.x);
        this.y < a.y ? this.y = a.y : this.y > b.y && (this.y = b.y);
        this.z < a.z ? this.z = a.z : this.z > b.z && (this.z = b.z);
        this.w < a.w ? this.w = a.w : this.w > b.w && (this.w = b.w);
        return this
    },
    clampScalar: function() {
        var a, b;
        return function(c, d) {
            void 0 === a && (a = new THREE.Vector4, b = new THREE.Vector4);
            a.set(c, c, c, c);
            b.set(d, d, d, d);
            return this.clamp(a, b)
        }
    }(),
    floor: function() {
        this.x = Math.floor(this.x);
        this.y = Math.floor(this.y);
        this.z = Math.floor(this.z);
        this.w = Math.floor(this.w);
        return this
    },
    ceil: function() {
        this.x = Math.ceil(this.x);
        this.y = Math.ceil(this.y);
        this.z = Math.ceil(this.z);
        this.w = Math.ceil(this.w);
        return this
    },
    round: function() {
        this.x = Math.round(this.x);
        this.y = Math.round(this.y);
        this.z = Math.round(this.z);
        this.w = Math.round(this.w);
        return this
    },
    roundToZero: function() {
        this.x = 0 > this.x ? Math.ceil(this.x) : Math.floor(this.x);
        this.y = 0 > this.y ? Math.ceil(this.y) : Math.floor(this.y);
        this.z = 0 > this.z ? Math.ceil(this.z) : Math.floor(this.z);
        this.w = 0 > this.w ? Math.ceil(this.w) :
            Math.floor(this.w);
        return this
    },
    negate: function() {
        return this.multiplyScalar(-1)
    },
    dot: function(a) {
        return this.x * a.x + this.y * a.y + this.z * a.z + this.w * a.w
    },
    lengthSq: function() {
        return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w
    },
    length: function() {
        return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w)
    },
    lengthManhattan: function() {
        return Math.abs(this.x) + Math.abs(this.y) + Math.abs(this.z) + Math.abs(this.w)
    },
    normalize: function() {
        return this.divideScalar(this.length())
    },
    setLength: function(a) {
        var b =
            this.length();
        0 !== b && a !== b && this.multiplyScalar(a / b);
        return this
    },
    lerp: function(a, b) {
        this.x += (a.x - this.x) * b;
        this.y += (a.y - this.y) * b;
        this.z += (a.z - this.z) * b;
        this.w += (a.w - this.w) * b;
        return this
    },
    equals: function(a) {
        return a.x === this.x && a.y === this.y && a.z === this.z && a.w === this.w
    },
    fromArray: function(a) {
        this.x = a[0];
        this.y = a[1];
        this.z = a[2];
        this.w = a[3];
        return this
    },
    toArray: function() {
        return [this.x, this.y, this.z, this.w]
    },
    clone: function() {
        return new THREE.Vector4(this.x, this.y, this.z, this.w)
    }
};
THREE.Euler = function(a, b, c, d) {
    this._x = a || 0;
    this._y = b || 0;
    this._z = c || 0;
    this._order = d || THREE.Euler.DefaultOrder
};
THREE.Euler.RotationOrders = "XYZ YZX ZXY XZY YXZ ZYX".split(" ");
THREE.Euler.DefaultOrder = "XYZ";
THREE.Euler.prototype = {
    constructor: THREE.Euler,
    _x: 0,
    _y: 0,
    _z: 0,
    _order: THREE.Euler.DefaultOrder,
    get x() {
        return this._x
    },
    set x(a) {
        this._x = a;
        this.onChangeCallback()
    },
    get y() {
        return this._y
    },
    set y(a) {
        this._y = a;
        this.onChangeCallback()
    },
    get z() {
        return this._z
    },
    set z(a) {
        this._z = a;
        this.onChangeCallback()
    },
    get order() {
        return this._order
    },
    set order(a) {
        this._order = a;
        this.onChangeCallback()
    },
    set: function(a, b, c, d) {
        this._x = a;
        this._y = b;
        this._z = c;
        this._order = d || this._order;
        this.onChangeCallback();
        return this
    },
    copy: function(a) {
        this._x =
            a._x;
        this._y = a._y;
        this._z = a._z;
        this._order = a._order;
        this.onChangeCallback();
        return this
    },
    setFromRotationMatrix: function(a, b) {
        var c = THREE.Math.clamp,
            d = a.elements,
            e = d[0],
            f = d[4],
            g = d[8],
            h = d[1],
            k = d[5],
            l = d[9],
            p = d[2],
            q = d[6],
            d = d[10];
        b = b || this._order;
        "XYZ" === b ? (this._y = Math.asin(c(g, -1, 1)), 0.99999 > Math.abs(g) ? (this._x = Math.atan2(-l, d), this._z = Math.atan2(-f, e)) : (this._x = Math.atan2(q, k), this._z = 0)) : "YXZ" === b ? (this._x = Math.asin(-c(l, -1, 1)), 0.99999 > Math.abs(l) ? (this._y = Math.atan2(g, d), this._z = Math.atan2(h, k)) :
            (this._y = Math.atan2(-p, e), this._z = 0)) : "ZXY" === b ? (this._x = Math.asin(c(q, -1, 1)), 0.99999 > Math.abs(q) ? (this._y = Math.atan2(-p, d), this._z = Math.atan2(-f, k)) : (this._y = 0, this._z = Math.atan2(h, e))) : "ZYX" === b ? (this._y = Math.asin(-c(p, -1, 1)), 0.99999 > Math.abs(p) ? (this._x = Math.atan2(q, d), this._z = Math.atan2(h, e)) : (this._x = 0, this._z = Math.atan2(-f, k))) : "YZX" === b ? (this._z = Math.asin(c(h, -1, 1)), 0.99999 > Math.abs(h) ? (this._x = Math.atan2(-l, k), this._y = Math.atan2(-p, e)) : (this._x = 0, this._y = Math.atan2(g, d))) : "XZY" === b ? (this._z =
            Math.asin(-c(f, -1, 1)), 0.99999 > Math.abs(f) ? (this._x = Math.atan2(q, k), this._y = Math.atan2(g, e)) : (this._x = Math.atan2(-l, d), this._y = 0)) : console.warn("THREE.Euler: .setFromRotationMatrix() given unsupported order: " + b);
        this._order = b;
        this.onChangeCallback();
        return this
    },
    setFromQuaternion: function(a, b, c) {
        var d = THREE.Math.clamp,
            e = a.x * a.x,
            f = a.y * a.y,
            g = a.z * a.z,
            h = a.w * a.w;
        b = b || this._order;
        "XYZ" === b ? (this._x = Math.atan2(2 * (a.x * a.w - a.y * a.z), h - e - f + g), this._y = Math.asin(d(2 * (a.x * a.z + a.y * a.w), -1, 1)), this._z = Math.atan2(2 *
                (a.z * a.w - a.x * a.y), h + e - f - g)) : "YXZ" === b ? (this._x = Math.asin(d(2 * (a.x * a.w - a.y * a.z), -1, 1)), this._y = Math.atan2(2 * (a.x * a.z + a.y * a.w), h - e - f + g), this._z = Math.atan2(2 * (a.x * a.y + a.z * a.w), h - e + f - g)) : "ZXY" === b ? (this._x = Math.asin(d(2 * (a.x * a.w + a.y * a.z), -1, 1)), this._y = Math.atan2(2 * (a.y * a.w - a.z * a.x), h - e - f + g), this._z = Math.atan2(2 * (a.z * a.w - a.x * a.y), h - e + f - g)) : "ZYX" === b ? (this._x = Math.atan2(2 * (a.x * a.w + a.z * a.y), h - e - f + g), this._y = Math.asin(d(2 * (a.y * a.w - a.x * a.z), -1, 1)), this._z = Math.atan2(2 * (a.x * a.y + a.z * a.w), h + e - f - g)) : "YZX" ===
            b ? (this._x = Math.atan2(2 * (a.x * a.w - a.z * a.y), h - e + f - g), this._y = Math.atan2(2 * (a.y * a.w - a.x * a.z), h + e - f - g), this._z = Math.asin(d(2 * (a.x * a.y + a.z * a.w), -1, 1))) : "XZY" === b ? (this._x = Math.atan2(2 * (a.x * a.w + a.y * a.z), h - e + f - g), this._y = Math.atan2(2 * (a.x * a.z + a.y * a.w), h + e - f - g), this._z = Math.asin(d(2 * (a.z * a.w - a.x * a.y), -1, 1))) : console.warn("THREE.Euler: .setFromQuaternion() given unsupported order: " + b);
        this._order = b;
        if (!1 !== c) this.onChangeCallback();
        return this
    },
    reorder: function() {
        var a = new THREE.Quaternion;
        return function(b) {
            a.setFromEuler(this);
            this.setFromQuaternion(a, b)
        }
    }(),
    equals: function(a) {
        return a._x === this._x && a._y === this._y && a._z === this._z && a._order === this._order
    },
    fromArray: function(a) {
        this._x = a[0];
        this._y = a[1];
        this._z = a[2];
        void 0 !== a[3] && (this._order = a[3]);
        this.onChangeCallback();
        return this
    },
    toArray: function() {
        return [this._x, this._y, this._z, this._order]
    },
    onChange: function(a) {
        this.onChangeCallback = a;
        return this
    },
    onChangeCallback: function() {},
    clone: function() {
        return new THREE.Euler(this._x, this._y, this._z, this._order)
    }
};
THREE.Line3 = function(a, b) {
    this.start = void 0 !== a ? a : new THREE.Vector3;
    this.end = void 0 !== b ? b : new THREE.Vector3
};
THREE.Line3.prototype = {
    constructor: THREE.Line3,
    set: function(a, b) {
        this.start.copy(a);
        this.end.copy(b);
        return this
    },
    copy: function(a) {
        this.start.copy(a.start);
        this.end.copy(a.end);
        return this
    },
    center: function(a) {
        return (a || new THREE.Vector3).addVectors(this.start, this.end).multiplyScalar(0.5)
    },
    delta: function(a) {
        return (a || new THREE.Vector3).subVectors(this.end, this.start)
    },
    distanceSq: function() {
        return this.start.distanceToSquared(this.end)
    },
    distance: function() {
        return this.start.distanceTo(this.end)
    },
    at: function(a,
        b) {
        var c = b || new THREE.Vector3;
        return this.delta(c).multiplyScalar(a).add(this.start)
    },
    closestPointToPointParameter: function() {
        var a = new THREE.Vector3,
            b = new THREE.Vector3;
        return function(c, d) {
            a.subVectors(c, this.start);
            b.subVectors(this.end, this.start);
            var e = b.dot(b),
                e = b.dot(a) / e;
            d && (e = THREE.Math.clamp(e, 0, 1));
            return e
        }
    }(),
    closestPointToPoint: function(a, b, c) {
        a = this.closestPointToPointParameter(a, b);
        c = c || new THREE.Vector3;
        return this.delta(c).multiplyScalar(a).add(this.start)
    },
    applyMatrix4: function(a) {
        this.start.applyMatrix4(a);
        this.end.applyMatrix4(a);
        return this
    },
    equals: function(a) {
        return a.start.equals(this.start) && a.end.equals(this.end)
    },
    clone: function() {
        return (new THREE.Line3).copy(this)
    }
};
THREE.Box2 = function(a, b) {
    this.min = void 0 !== a ? a : new THREE.Vector2(Infinity, Infinity);
    this.max = void 0 !== b ? b : new THREE.Vector2(-Infinity, -Infinity)
};
THREE.Box2.prototype = {
    constructor: THREE.Box2,
    set: function(a, b) {
        this.min.copy(a);
        this.max.copy(b);
        return this
    },
    setFromPoints: function(a) {
        this.makeEmpty();
        for (var b = 0, c = a.length; b < c; b++) this.expandByPoint(a[b]);
        return this
    },
    setFromCenterAndSize: function() {
        var a = new THREE.Vector2;
        return function(b, c) {
            var d = a.copy(c).multiplyScalar(0.5);
            this.min.copy(b).sub(d);
            this.max.copy(b).add(d);
            return this
        }
    }(),
    copy: function(a) {
        this.min.copy(a.min);
        this.max.copy(a.max);
        return this
    },
    makeEmpty: function() {
        this.min.x =
            this.min.y = Infinity;
        this.max.x = this.max.y = -Infinity;
        return this
    },
    empty: function() {
        return this.max.x < this.min.x || this.max.y < this.min.y
    },
    center: function(a) {
        return (a || new THREE.Vector2).addVectors(this.min, this.max).multiplyScalar(0.5)
    },
    size: function(a) {
        return (a || new THREE.Vector2).subVectors(this.max, this.min)
    },
    expandByPoint: function(a) {
        this.min.min(a);
        this.max.max(a);
        return this
    },
    expandByVector: function(a) {
        this.min.sub(a);
        this.max.add(a);
        return this
    },
    expandByScalar: function(a) {
        this.min.addScalar(-a);
        this.max.addScalar(a);
        return this
    },
    containsPoint: function(a) {
        return a.x < this.min.x || a.x > this.max.x || a.y < this.min.y || a.y > this.max.y ? !1 : !0
    },
    containsBox: function(a) {
        return this.min.x <= a.min.x && a.max.x <= this.max.x && this.min.y <= a.min.y && a.max.y <= this.max.y ? !0 : !1
    },
    getParameter: function(a, b) {
        return (b || new THREE.Vector2).set((a.x - this.min.x) / (this.max.x - this.min.x), (a.y - this.min.y) / (this.max.y - this.min.y))
    },
    isIntersectionBox: function(a) {
        return a.max.x < this.min.x || a.min.x > this.max.x || a.max.y < this.min.y || a.min.y >
            this.max.y ? !1 : !0
    },
    clampPoint: function(a, b) {
        return (b || new THREE.Vector2).copy(a).clamp(this.min, this.max)
    },
    distanceToPoint: function() {
        var a = new THREE.Vector2;
        return function(b) {
            return a.copy(b).clamp(this.min, this.max).sub(b).length()
        }
    }(),
    intersect: function(a) {
        this.min.max(a.min);
        this.max.min(a.max);
        return this
    },
    union: function(a) {
        this.min.min(a.min);
        this.max.max(a.max);
        return this
    },
    translate: function(a) {
        this.min.add(a);
        this.max.add(a);
        return this
    },
    equals: function(a) {
        return a.min.equals(this.min) &&
            a.max.equals(this.max)
    },
    clone: function() {
        return (new THREE.Box2).copy(this)
    }
};
THREE.Box3 = function(a, b) {
    this.min = void 0 !== a ? a : new THREE.Vector3(Infinity, Infinity, Infinity);
    this.max = void 0 !== b ? b : new THREE.Vector3(-Infinity, -Infinity, -Infinity)
};
THREE.Box3.prototype = {
    constructor: THREE.Box3,
    set: function(a, b) {
        this.min.copy(a);
        this.max.copy(b);
        return this
    },
    setFromPoints: function(a) {
        this.makeEmpty();
        for (var b = 0, c = a.length; b < c; b++) this.expandByPoint(a[b]);
        return this
    },
    setFromCenterAndSize: function() {
        var a = new THREE.Vector3;
        return function(b, c) {
            var d = a.copy(c).multiplyScalar(0.5);
            this.min.copy(b).sub(d);
            this.max.copy(b).add(d);
            return this
        }
    }(),
    setFromObject: function() {
        var a = new THREE.Vector3;
        return function(b) {
            var c = this;
            b.updateMatrixWorld(!0);
            this.makeEmpty();
            b.traverse(function(b) {
                if (void 0 !== b.geometry && void 0 !== b.geometry.vertices)
                    for (var e = b.geometry.vertices, f = 0, g = e.length; f < g; f++) a.copy(e[f]), a.applyMatrix4(b.matrixWorld), c.expandByPoint(a)
            });
            return this
        }
    }(),
    copy: function(a) {
        this.min.copy(a.min);
        this.max.copy(a.max);
        return this
    },
    makeEmpty: function() {
        this.min.x = this.min.y = this.min.z = Infinity;
        this.max.x = this.max.y = this.max.z = -Infinity;
        return this
    },
    empty: function() {
        return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z
    },
    center: function(a) {
        return (a || new THREE.Vector3).addVectors(this.min, this.max).multiplyScalar(0.5)
    },
    size: function(a) {
        return (a || new THREE.Vector3).subVectors(this.max, this.min)
    },
    expandByPoint: function(a) {
        this.min.min(a);
        this.max.max(a);
        return this
    },
    expandByVector: function(a) {
        this.min.sub(a);
        this.max.add(a);
        return this
    },
    expandByScalar: function(a) {
        this.min.addScalar(-a);
        this.max.addScalar(a);
        return this
    },
    containsPoint: function(a) {
        return a.x < this.min.x || a.x > this.max.x || a.y < this.min.y || a.y > this.max.y ||
            a.z < this.min.z || a.z > this.max.z ? !1 : !0
    },
    containsBox: function(a) {
        return this.min.x <= a.min.x && a.max.x <= this.max.x && this.min.y <= a.min.y && a.max.y <= this.max.y && this.min.z <= a.min.z && a.max.z <= this.max.z ? !0 : !1
    },
    getParameter: function(a, b) {
        return (b || new THREE.Vector3).set((a.x - this.min.x) / (this.max.x - this.min.x), (a.y - this.min.y) / (this.max.y - this.min.y), (a.z - this.min.z) / (this.max.z - this.min.z))
    },
    isIntersectionBox: function(a) {
        return a.max.x < this.min.x || a.min.x > this.max.x || a.max.y < this.min.y || a.min.y > this.max.y ||
            a.max.z < this.min.z || a.min.z > this.max.z ? !1 : !0
    },
    clampPoint: function(a, b) {
        return (b || new THREE.Vector3).copy(a).clamp(this.min, this.max)
    },
    distanceToPoint: function() {
        var a = new THREE.Vector3;
        return function(b) {
            return a.copy(b).clamp(this.min, this.max).sub(b).length()
        }
    }(),
    getBoundingSphere: function() {
        var a = new THREE.Vector3;
        return function(b) {
            b = b || new THREE.Sphere;
            b.center = this.center();
            b.radius = 0.5 * this.size(a).length();
            return b
        }
    }(),
    intersect: function(a) {
        this.min.max(a.min);
        this.max.min(a.max);
        return this
    },
    union: function(a) {
        this.min.min(a.min);
        this.max.max(a.max);
        return this
    },
    applyMatrix4: function() {
        var a = [new THREE.Vector3, new THREE.Vector3, new THREE.Vector3, new THREE.Vector3, new THREE.Vector3, new THREE.Vector3, new THREE.Vector3, new THREE.Vector3];
        return function(b) {
            a[0].set(this.min.x, this.min.y, this.min.z).applyMatrix4(b);
            a[1].set(this.min.x, this.min.y, this.max.z).applyMatrix4(b);
            a[2].set(this.min.x, this.max.y, this.min.z).applyMatrix4(b);
            a[3].set(this.min.x, this.max.y, this.max.z).applyMatrix4(b);
            a[4].set(this.max.x, this.min.y, this.min.z).applyMatrix4(b);
            a[5].set(this.max.x, this.min.y, this.max.z).applyMatrix4(b);
            a[6].set(this.max.x, this.max.y, this.min.z).applyMatrix4(b);
            a[7].set(this.max.x, this.max.y, this.max.z).applyMatrix4(b);
            this.makeEmpty();
            this.setFromPoints(a);
            return this
        }
    }(),
    translate: function(a) {
        this.min.add(a);
        this.max.add(a);
        return this
    },
    equals: function(a) {
        return a.min.equals(this.min) && a.max.equals(this.max)
    },
    clone: function() {
        return (new THREE.Box3).copy(this)
    }
};
THREE.Matrix3 = function(a, b, c, d, e, f, g, h, k) {
    var l = this.elements = new Float32Array(9);
    l[0] = void 0 !== a ? a : 1;
    l[3] = b || 0;
    l[6] = c || 0;
    l[1] = d || 0;
    l[4] = void 0 !== e ? e : 1;
    l[7] = f || 0;
    l[2] = g || 0;
    l[5] = h || 0;
    l[8] = void 0 !== k ? k : 1
};
THREE.Matrix3.prototype = {
    constructor: THREE.Matrix3,
    set: function(a, b, c, d, e, f, g, h, k) {
        var l = this.elements;
        l[0] = a;
        l[3] = b;
        l[6] = c;
        l[1] = d;
        l[4] = e;
        l[7] = f;
        l[2] = g;
        l[5] = h;
        l[8] = k;
        return this
    },
    identity: function() {
        this.set(1, 0, 0, 0, 1, 0, 0, 0, 1);
        return this
    },
    copy: function(a) {
        a = a.elements;
        this.set(a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]);
        return this
    },
    multiplyVector3: function(a) {
        console.warn("THREE.Matrix3: .multiplyVector3() has been removed. Use vector.applyMatrix3( matrix ) instead.");
        return a.applyMatrix3(this)
    },
    multiplyVector3Array: function(a) {
        console.warn("THREE.Matrix3: .multiplyVector3Array() has been renamed. Use matrix.applyToVector3Array( array ) instead.");
        return this.applyToVector3Array(a)
    },
    applyToVector3Array: function() {
        var a = new THREE.Vector3;
        return function(b, c, d) {
            void 0 === c && (c = 0);
            void 0 === d && (d = b.length);
            for (var e = 0; e < d; e += 3, c += 3) a.x = b[c], a.y = b[c + 1], a.z = b[c + 2], a.applyMatrix3(this), b[c] = a.x, b[c + 1] = a.y, b[c + 2] = a.z;
            return b
        }
    }(),
    multiplyScalar: function(a) {
        var b = this.elements;
        b[0] *= a;
        b[3] *= a;
        b[6] *=
            a;
        b[1] *= a;
        b[4] *= a;
        b[7] *= a;
        b[2] *= a;
        b[5] *= a;
        b[8] *= a;
        return this
    },
    determinant: function() {
        var a = this.elements,
            b = a[0],
            c = a[1],
            d = a[2],
            e = a[3],
            f = a[4],
            g = a[5],
            h = a[6],
            k = a[7],
            a = a[8];
        return b * f * a - b * g * k - c * e * a + c * g * h + d * e * k - d * f * h
    },
    getInverse: function(a, b) {
        var c = a.elements,
            d = this.elements;
        d[0] = c[10] * c[5] - c[6] * c[9];
        d[1] = -c[10] * c[1] + c[2] * c[9];
        d[2] = c[6] * c[1] - c[2] * c[5];
        d[3] = -c[10] * c[4] + c[6] * c[8];
        d[4] = c[10] * c[0] - c[2] * c[8];
        d[5] = -c[6] * c[0] + c[2] * c[4];
        d[6] = c[9] * c[4] - c[5] * c[8];
        d[7] = -c[9] * c[0] + c[1] * c[8];
        d[8] = c[5] * c[0] - c[1] * c[4];
        c = c[0] * d[0] + c[1] * d[3] + c[2] * d[6];
        if (0 === c) {
            if (b) throw Error("Matrix3.getInverse(): can't invert matrix, determinant is 0");
            console.warn("Matrix3.getInverse(): can't invert matrix, determinant is 0");
            this.identity();
            return this
        }
        this.multiplyScalar(1 / c);
        return this
    },
    transpose: function() {
        var a, b = this.elements;
        a = b[1];
        b[1] = b[3];
        b[3] = a;
        a = b[2];
        b[2] = b[6];
        b[6] = a;
        a = b[5];
        b[5] = b[7];
        b[7] = a;
        return this
    },
    flattenToArrayOffset: function(a, b) {
        var c = this.elements;
        a[b] = c[0];
        a[b + 1] = c[1];
        a[b + 2] = c[2];
        a[b + 3] = c[3];
        a[b + 4] = c[4];
        a[b + 5] = c[5];
        a[b + 6] = c[6];
        a[b + 7] = c[7];
        a[b + 8] = c[8];
        return a
    },
    getNormalMatrix: function(a) {
        this.getInverse(a).transpose();
        return this
    },
    transposeIntoArray: function(a) {
        var b = this.elements;
        a[0] = b[0];
        a[1] = b[3];
        a[2] = b[6];
        a[3] = b[1];
        a[4] = b[4];
        a[5] = b[7];
        a[6] = b[2];
        a[7] = b[5];
        a[8] = b[8];
        return this
    },
    fromArray: function(a) {
        this.elements.set(a);
        return this
    },
    toArray: function() {
        var a = this.elements;
        return [a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8]]
    },
    clone: function() {
        var a = this.elements;
        return new THREE.Matrix3(a[0], a[3],
            a[6], a[1], a[4], a[7], a[2], a[5], a[8])
    }
};
THREE.Matrix4 = function(a, b, c, d, e, f, g, h, k, l, p, q, r, t, s, n) {
    var v = this.elements = new Float32Array(16);
    v[0] = void 0 !== a ? a : 1;
    v[4] = b || 0;
    v[8] = c || 0;
    v[12] = d || 0;
    v[1] = e || 0;
    v[5] = void 0 !== f ? f : 1;
    v[9] = g || 0;
    v[13] = h || 0;
    v[2] = k || 0;
    v[6] = l || 0;
    v[10] = void 0 !== p ? p : 1;
    v[14] = q || 0;
    v[3] = r || 0;
    v[7] = t || 0;
    v[11] = s || 0;
    v[15] = void 0 !== n ? n : 1
};
THREE.Matrix4.prototype = {
    constructor: THREE.Matrix4,
    set: function(a, b, c, d, e, f, g, h, k, l, p, q, r, t, s, n) {
        var v = this.elements;
        v[0] = a;
        v[4] = b;
        v[8] = c;
        v[12] = d;
        v[1] = e;
        v[5] = f;
        v[9] = g;
        v[13] = h;
        v[2] = k;
        v[6] = l;
        v[10] = p;
        v[14] = q;
        v[3] = r;
        v[7] = t;
        v[11] = s;
        v[15] = n;
        return this
    },
    identity: function() {
        this.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
        return this
    },
    copy: function(a) {
        this.elements.set(a.elements);
        return this
    },
    extractPosition: function(a) {
        console.warn("THREEMatrix4: .extractPosition() has been renamed to .copyPosition().");
        return this.copyPosition(a)
    },
    copyPosition: function(a) {
        var b = this.elements;
        a = a.elements;
        b[12] = a[12];
        b[13] = a[13];
        b[14] = a[14];
        return this
    },
    extractRotation: function() {
        var a = new THREE.Vector3;
        return function(b) {
            var c = this.elements;
            b = b.elements;
            var d = 1 / a.set(b[0], b[1], b[2]).length(),
                e = 1 / a.set(b[4], b[5], b[6]).length(),
                f = 1 / a.set(b[8], b[9], b[10]).length();
            c[0] = b[0] * d;
            c[1] = b[1] * d;
            c[2] = b[2] * d;
            c[4] = b[4] * e;
            c[5] = b[5] * e;
            c[6] = b[6] * e;
            c[8] = b[8] * f;
            c[9] = b[9] * f;
            c[10] = b[10] * f;
            return this
        }
    }(),
    makeRotationFromEuler: function(a) {
        !1 === a instanceof THREE.Euler &&
            console.error("THREE.Matrix: .makeRotationFromEuler() now expects a Euler rotation rather than a Vector3 and order.");
        var b = this.elements,
            c = a.x,
            d = a.y,
            e = a.z,
            f = Math.cos(c),
            c = Math.sin(c),
            g = Math.cos(d),
            d = Math.sin(d),
            h = Math.cos(e),
            e = Math.sin(e);
        if ("XYZ" === a.order) {
            a = f * h;
            var k = f * e,
                l = c * h,
                p = c * e;
            b[0] = g * h;
            b[4] = -g * e;
            b[8] = d;
            b[1] = k + l * d;
            b[5] = a - p * d;
            b[9] = -c * g;
            b[2] = p - a * d;
            b[6] = l + k * d;
            b[10] = f * g
        } else "YXZ" === a.order ? (a = g * h, k = g * e, l = d * h, p = d * e, b[0] = a + p * c, b[4] = l * c - k, b[8] = f * d, b[1] = f * e, b[5] = f * h, b[9] = -c, b[2] = k * c - l, b[6] = p + a * c,
            b[10] = f * g) : "ZXY" === a.order ? (a = g * h, k = g * e, l = d * h, p = d * e, b[0] = a - p * c, b[4] = -f * e, b[8] = l + k * c, b[1] = k + l * c, b[5] = f * h, b[9] = p - a * c, b[2] = -f * d, b[6] = c, b[10] = f * g) : "ZYX" === a.order ? (a = f * h, k = f * e, l = c * h, p = c * e, b[0] = g * h, b[4] = l * d - k, b[8] = a * d + p, b[1] = g * e, b[5] = p * d + a, b[9] = k * d - l, b[2] = -d, b[6] = c * g, b[10] = f * g) : "YZX" === a.order ? (a = f * g, k = f * d, l = c * g, p = c * d, b[0] = g * h, b[4] = p - a * e, b[8] = l * e + k, b[1] = e, b[5] = f * h, b[9] = -c * h, b[2] = -d * h, b[6] = k * e + l, b[10] = a - p * e) : "XZY" === a.order && (a = f * g, k = f * d, l = c * g, p = c * d, b[0] = g * h, b[4] = -e, b[8] = d * h, b[1] = a * e + p, b[5] = f * h, b[9] = k *
            e - l, b[2] = l * e - k, b[6] = c * h, b[10] = p * e + a);
        b[3] = 0;
        b[7] = 0;
        b[11] = 0;
        b[12] = 0;
        b[13] = 0;
        b[14] = 0;
        b[15] = 1;
        return this
    },
    setRotationFromQuaternion: function(a) {
        console.warn("THREE.Matrix4: .setRotationFromQuaternion() has been renamed to .makeRotationFromQuaternion().");
        return this.makeRotationFromQuaternion(a)
    },
    makeRotationFromQuaternion: function(a) {
        var b = this.elements,
            c = a.x,
            d = a.y,
            e = a.z,
            f = a.w,
            g = c + c,
            h = d + d,
            k = e + e;
        a = c * g;
        var l = c * h,
            c = c * k,
            p = d * h,
            d = d * k,
            e = e * k,
            g = f * g,
            h = f * h,
            f = f * k;
        b[0] = 1 - (p + e);
        b[4] = l - f;
        b[8] = c + h;
        b[1] = l + f;
        b[5] = 1 -
            (a + e);
        b[9] = d - g;
        b[2] = c - h;
        b[6] = d + g;
        b[10] = 1 - (a + p);
        b[3] = 0;
        b[7] = 0;
        b[11] = 0;
        b[12] = 0;
        b[13] = 0;
        b[14] = 0;
        b[15] = 1;
        return this
    },
    lookAt: function() {
        var a = new THREE.Vector3,
            b = new THREE.Vector3,
            c = new THREE.Vector3;
        return function(d, e, f) {
            var g = this.elements;
            c.subVectors(d, e).normalize();
            0 === c.length() && (c.z = 1);
            a.crossVectors(f, c).normalize();
            0 === a.length() && (c.x += 1E-4, a.crossVectors(f, c).normalize());
            b.crossVectors(c, a);
            g[0] = a.x;
            g[4] = b.x;
            g[8] = c.x;
            g[1] = a.y;
            g[5] = b.y;
            g[9] = c.y;
            g[2] = a.z;
            g[6] = b.z;
            g[10] = c.z;
            return this
        }
    }(),
    multiply: function(a, b) {
        return void 0 !== b ? (console.warn("THREE.Matrix4: .multiply() now only accepts one argument. Use .multiplyMatrices( a, b ) instead."), this.multiplyMatrices(a, b)) : this.multiplyMatrices(this, a)
    },
    multiplyMatrices: function(a, b) {
        var c = a.elements,
            d = b.elements,
            e = this.elements,
            f = c[0],
            g = c[4],
            h = c[8],
            k = c[12],
            l = c[1],
            p = c[5],
            q = c[9],
            r = c[13],
            t = c[2],
            s = c[6],
            n = c[10],
            v = c[14],
            w = c[3],
            u = c[7],
            x = c[11],
            c = c[15],
            K = d[0],
            A = d[4],
            G = d[8],
            B = d[12],
            C = d[1],
            E = d[5],
            H = d[9],
            y = d[13],
            Q = d[2],
            z = d[6],
            R = d[10],
            L = d[14],
            I = d[3],
            F = d[7],
            P = d[11],
            d = d[15];
        e[0] = f * K + g * C + h * Q + k * I;
        e[4] = f * A + g * E + h * z + k * F;
        e[8] = f * G + g * H + h * R + k * P;
        e[12] = f * B + g * y + h * L + k * d;
        e[1] = l * K + p * C + q * Q + r * I;
        e[5] = l * A + p * E + q * z + r * F;
        e[9] = l * G + p * H + q * R + r * P;
        e[13] = l * B + p * y + q * L + r * d;
        e[2] = t * K + s * C + n * Q + v * I;
        e[6] = t * A + s * E + n * z + v * F;
        e[10] = t * G + s * H + n * R + v * P;
        e[14] = t * B + s * y + n * L + v * d;
        e[3] = w * K + u * C + x * Q + c * I;
        e[7] = w * A + u * E + x * z + c * F;
        e[11] = w * G + u * H + x * R + c * P;
        e[15] = w * B + u * y + x * L + c * d;
        return this
    },
    multiplyToArray: function(a, b, c) {
        var d = this.elements;
        this.multiplyMatrices(a, b);
        c[0] = d[0];
        c[1] = d[1];
        c[2] = d[2];
        c[3] = d[3];
        c[4] =
            d[4];
        c[5] = d[5];
        c[6] = d[6];
        c[7] = d[7];
        c[8] = d[8];
        c[9] = d[9];
        c[10] = d[10];
        c[11] = d[11];
        c[12] = d[12];
        c[13] = d[13];
        c[14] = d[14];
        c[15] = d[15];
        return this
    },
    multiplyScalar: function(a) {
        var b = this.elements;
        b[0] *= a;
        b[4] *= a;
        b[8] *= a;
        b[12] *= a;
        b[1] *= a;
        b[5] *= a;
        b[9] *= a;
        b[13] *= a;
        b[2] *= a;
        b[6] *= a;
        b[10] *= a;
        b[14] *= a;
        b[3] *= a;
        b[7] *= a;
        b[11] *= a;
        b[15] *= a;
        return this
    },
    multiplyVector3: function(a) {
        console.warn("THREE.Matrix4: .multiplyVector3() has been removed. Use vector.applyMatrix4( matrix ) or vector.applyProjection( matrix ) instead.");
        return a.applyProjection(this)
    },
    multiplyVector4: function(a) {
        console.warn("THREE.Matrix4: .multiplyVector4() has been removed. Use vector.applyMatrix4( matrix ) instead.");
        return a.applyMatrix4(this)
    },
    multiplyVector3Array: function(a) {
        console.warn("THREE.Matrix4: .multiplyVector3Array() has been renamed. Use matrix.applyToVector3Array( array ) instead.");
        return this.applyToVector3Array(a)
    },
    applyToVector3Array: function() {
        var a = new THREE.Vector3;
        return function(b, c, d) {
            void 0 === c && (c = 0);
            void 0 === d && (d =
                b.length);
            for (var e = 0; e < d; e += 3, c += 3) a.x = b[c], a.y = b[c + 1], a.z = b[c + 2], a.applyMatrix4(this), b[c] = a.x, b[c + 1] = a.y, b[c + 2] = a.z;
            return b
        }
    }(),
    rotateAxis: function(a) {
        console.warn("THREE.Matrix4: .rotateAxis() has been removed. Use Vector3.transformDirection( matrix ) instead.");
        a.transformDirection(this)
    },
    crossVector: function(a) {
        console.warn("THREE.Matrix4: .crossVector() has been removed. Use vector.applyMatrix4( matrix ) instead.");
        return a.applyMatrix4(this)
    },
    determinant: function() {
        var a = this.elements,
            b =
            a[0],
            c = a[4],
            d = a[8],
            e = a[12],
            f = a[1],
            g = a[5],
            h = a[9],
            k = a[13],
            l = a[2],
            p = a[6],
            q = a[10],
            r = a[14];
        return a[3] * (+e * h * p - d * k * p - e * g * q + c * k * q + d * g * r - c * h * r) + a[7] * (+b * h * r - b * k * q + e * f * q - d * f * r + d * k * l - e * h * l) + a[11] * (+b * k * p - b * g * r - e * f * p + c * f * r + e * g * l - c * k * l) + a[15] * (-d * g * l - b * h * p + b * g * q + d * f * p - c * f * q + c * h * l)
    },
    transpose: function() {
        var a = this.elements,
            b;
        b = a[1];
        a[1] = a[4];
        a[4] = b;
        b = a[2];
        a[2] = a[8];
        a[8] = b;
        b = a[6];
        a[6] = a[9];
        a[9] = b;
        b = a[3];
        a[3] = a[12];
        a[12] = b;
        b = a[7];
        a[7] = a[13];
        a[13] = b;
        b = a[11];
        a[11] = a[14];
        a[14] = b;
        return this
    },
    flattenToArrayOffset: function(a,
        b) {
        var c = this.elements;
        a[b] = c[0];
        a[b + 1] = c[1];
        a[b + 2] = c[2];
        a[b + 3] = c[3];
        a[b + 4] = c[4];
        a[b + 5] = c[5];
        a[b + 6] = c[6];
        a[b + 7] = c[7];
        a[b + 8] = c[8];
        a[b + 9] = c[9];
        a[b + 10] = c[10];
        a[b + 11] = c[11];
        a[b + 12] = c[12];
        a[b + 13] = c[13];
        a[b + 14] = c[14];
        a[b + 15] = c[15];
        return a
    },
    getPosition: function() {
        var a = new THREE.Vector3;
        return function() {
            console.warn("THREE.Matrix4: .getPosition() has been removed. Use Vector3.setFromMatrixPosition( matrix ) instead.");
            var b = this.elements;
            return a.set(b[12], b[13], b[14])
        }
    }(),
    setPosition: function(a) {
        var b =
            this.elements;
        b[12] = a.x;
        b[13] = a.y;
        b[14] = a.z;
        return this
    },
    getInverse: function(a, b) {
        var c = this.elements,
            d = a.elements,
            e = d[0],
            f = d[4],
            g = d[8],
            h = d[12],
            k = d[1],
            l = d[5],
            p = d[9],
            q = d[13],
            r = d[2],
            t = d[6],
            s = d[10],
            n = d[14],
            v = d[3],
            w = d[7],
            u = d[11],
            d = d[15];
        c[0] = p * n * w - q * s * w + q * t * u - l * n * u - p * t * d + l * s * d;
        c[4] = h * s * w - g * n * w - h * t * u + f * n * u + g * t * d - f * s * d;
        c[8] = g * q * w - h * p * w + h * l * u - f * q * u - g * l * d + f * p * d;
        c[12] = h * p * t - g * q * t - h * l * s + f * q * s + g * l * n - f * p * n;
        c[1] = q * s * v - p * n * v - q * r * u + k * n * u + p * r * d - k * s * d;
        c[5] = g * n * v - h * s * v + h * r * u - e * n * u - g * r * d + e * s * d;
        c[9] = h * p * v - g * q * v - h * k *
            u + e * q * u + g * k * d - e * p * d;
        c[13] = g * q * r - h * p * r + h * k * s - e * q * s - g * k * n + e * p * n;
        c[2] = l * n * v - q * t * v + q * r * w - k * n * w - l * r * d + k * t * d;
        c[6] = h * t * v - f * n * v - h * r * w + e * n * w + f * r * d - e * t * d;
        c[10] = f * q * v - h * l * v + h * k * w - e * q * w - f * k * d + e * l * d;
        c[14] = h * l * r - f * q * r - h * k * t + e * q * t + f * k * n - e * l * n;
        c[3] = p * t * v - l * s * v - p * r * w + k * s * w + l * r * u - k * t * u;
        c[7] = f * s * v - g * t * v + g * r * w - e * s * w - f * r * u + e * t * u;
        c[11] = g * l * v - f * p * v - g * k * w + e * p * w + f * k * u - e * l * u;
        c[15] = f * p * r - g * l * r + g * k * t - e * p * t - f * k * s + e * l * s;
        c = e * c[0] + k * c[4] + r * c[8] + v * c[12];
        if (0 == c) {
            if (b) throw Error("Matrix4.getInverse(): can't invert matrix, determinant is 0");
            console.warn("Matrix4.getInverse(): can't invert matrix, determinant is 0");
            this.identity();
            return this
        }
        this.multiplyScalar(1 / c);
        return this
    },
    translate: function(a) {
        console.warn("THREE.Matrix4: .translate() has been removed.")
    },
    rotateX: function(a) {
        console.warn("THREE.Matrix4: .rotateX() has been removed.")
    },
    rotateY: function(a) {
        console.warn("THREE.Matrix4: .rotateY() has been removed.")
    },
    rotateZ: function(a) {
        console.warn("THREE.Matrix4: .rotateZ() has been removed.")
    },
    rotateByAxis: function(a, b) {
        console.warn("THREE.Matrix4: .rotateByAxis() has been removed.")
    },
    scale: function(a) {
        var b = this.elements,
            c = a.x,
            d = a.y;
        a = a.z;
        b[0] *= c;
        b[4] *= d;
        b[8] *= a;
        b[1] *= c;
        b[5] *= d;
        b[9] *= a;
        b[2] *= c;
        b[6] *= d;
        b[10] *= a;
        b[3] *= c;
        b[7] *= d;
        b[11] *= a;
        return this
    },
    getMaxScaleOnAxis: function() {
        var a = this.elements;
        return Math.sqrt(Math.max(a[0] * a[0] + a[1] * a[1] + a[2] * a[2], Math.max(a[4] * a[4] + a[5] * a[5] + a[6] * a[6], a[8] * a[8] + a[9] * a[9] + a[10] * a[10])))
    },
    makeTranslation: function(a, b, c) {
        this.set(1, 0, 0, a, 0, 1, 0, b, 0, 0, 1, c, 0, 0, 0, 1);
        return this
    },
    makeRotationX: function(a) {
        var b = Math.cos(a);
        a = Math.sin(a);
        this.set(1,
            0, 0, 0, 0, b, -a, 0, 0, a, b, 0, 0, 0, 0, 1);
        return this
    },
    makeRotationY: function(a) {
        var b = Math.cos(a);
        a = Math.sin(a);
        this.set(b, 0, a, 0, 0, 1, 0, 0, -a, 0, b, 0, 0, 0, 0, 1);
        return this
    },
    makeRotationZ: function(a) {
        var b = Math.cos(a);
        a = Math.sin(a);
        this.set(b, -a, 0, 0, a, b, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
        return this
    },
    makeRotationAxis: function(a, b) {
        var c = Math.cos(b),
            d = Math.sin(b),
            e = 1 - c,
            f = a.x,
            g = a.y,
            h = a.z,
            k = e * f,
            l = e * g;
        this.set(k * f + c, k * g - d * h, k * h + d * g, 0, k * g + d * h, l * g + c, l * h - d * f, 0, k * h - d * g, l * h + d * f, e * h * h + c, 0, 0, 0, 0, 1);
        return this
    },
    makeScale: function(a, b, c) {
        this.set(a,
            0, 0, 0, 0, b, 0, 0, 0, 0, c, 0, 0, 0, 0, 1);
        return this
    },
    compose: function(a, b, c) {
        this.makeRotationFromQuaternion(b);
        this.scale(c);
        this.setPosition(a);
        return this
    },
    decompose: function() {
        var a = new THREE.Vector3,
            b = new THREE.Matrix4;
        return function(c, d, e) {
            var f = this.elements,
                g = a.set(f[0], f[1], f[2]).length(),
                h = a.set(f[4], f[5], f[6]).length(),
                k = a.set(f[8], f[9], f[10]).length();
            0 > this.determinant() && (g = -g);
            c.x = f[12];
            c.y = f[13];
            c.z = f[14];
            b.elements.set(this.elements);
            c = 1 / g;
            var f = 1 / h,
                l = 1 / k;
            b.elements[0] *= c;
            b.elements[1] *=
                c;
            b.elements[2] *= c;
            b.elements[4] *= f;
            b.elements[5] *= f;
            b.elements[6] *= f;
            b.elements[8] *= l;
            b.elements[9] *= l;
            b.elements[10] *= l;
            d.setFromRotationMatrix(b);
            e.x = g;
            e.y = h;
            e.z = k;
            return this
        }
    }(),
    makeFrustum: function(a, b, c, d, e, f) {
        var g = this.elements;
        g[0] = 2 * e / (b - a);
        g[4] = 0;
        g[8] = (b + a) / (b - a);
        g[12] = 0;
        g[1] = 0;
        g[5] = 2 * e / (d - c);
        g[9] = (d + c) / (d - c);
        g[13] = 0;
        g[2] = 0;
        g[6] = 0;
        g[10] = -(f + e) / (f - e);
        g[14] = -2 * f * e / (f - e);
        g[3] = 0;
        g[7] = 0;
        g[11] = -1;
        g[15] = 0;
        return this
    },
    makePerspective: function(a, b, c, d) {
        a = c * Math.tan(THREE.Math.degToRad(0.5 * a));
        var e = -a;
        return this.makeFrustum(e * b, a * b, e, a, c, d)
    },
    makeOrthographic: function(a, b, c, d, e, f) {
        var g = this.elements,
            h = b - a,
            k = c - d,
            l = f - e;
        g[0] = 2 / h;
        g[4] = 0;
        g[8] = 0;
        g[12] = -((b + a) / h);
        g[1] = 0;
        g[5] = 2 / k;
        g[9] = 0;
        g[13] = -((c + d) / k);
        g[2] = 0;
        g[6] = 0;
        g[10] = -2 / l;
        g[14] = -((f + e) / l);
        g[3] = 0;
        g[7] = 0;
        g[11] = 0;
        g[15] = 1;
        return this
    },
    fromArray: function(a) {
        this.elements.set(a);
        return this
    },
    toArray: function() {
        var a = this.elements;
        return [a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8], a[9], a[10], a[11], a[12], a[13], a[14], a[15]]
    },
    clone: function() {
        var a =
            this.elements;
        return new THREE.Matrix4(a[0], a[4], a[8], a[12], a[1], a[5], a[9], a[13], a[2], a[6], a[10], a[14], a[3], a[7], a[11], a[15])
    }
};
THREE.Ray = function(a, b) {
    this.origin = void 0 !== a ? a : new THREE.Vector3;
    this.direction = void 0 !== b ? b : new THREE.Vector3
};
THREE.Ray.prototype = {
    constructor: THREE.Ray,
    set: function(a, b) {
        this.origin.copy(a);
        this.direction.copy(b);
        return this
    },
    copy: function(a) {
        this.origin.copy(a.origin);
        this.direction.copy(a.direction);
        return this
    },
    at: function(a, b) {
        return (b || new THREE.Vector3).copy(this.direction).multiplyScalar(a).add(this.origin)
    },
    recast: function() {
        var a = new THREE.Vector3;
        return function(b) {
            this.origin.copy(this.at(b, a));
            return this
        }
    }(),
    closestPointToPoint: function(a, b) {
        var c = b || new THREE.Vector3;
        c.subVectors(a, this.origin);
        var d = c.dot(this.direction);
        return 0 > d ? c.copy(this.origin) : c.copy(this.direction).multiplyScalar(d).add(this.origin)
    },
    distanceToPoint: function() {
        var a = new THREE.Vector3;
        return function(b) {
            var c = a.subVectors(b, this.origin).dot(this.direction);
            if (0 > c) return this.origin.distanceTo(b);
            a.copy(this.direction).multiplyScalar(c).add(this.origin);
            return a.distanceTo(b)
        }
    }(),
    distanceSqToSegment: function(a, b, c, d) {
        var e = a.clone().add(b).multiplyScalar(0.5),
            f = b.clone().sub(a).normalize(),
            g = 0.5 * a.distanceTo(b),
            h = this.origin.clone().sub(e);
        a = -this.direction.dot(f);
        b = h.dot(this.direction);
        var k = -h.dot(f),
            l = h.lengthSq(),
            p = Math.abs(1 - a * a),
            q, r;
        0 <= p ? (h = a * k - b, q = a * b - k, r = g * p, 0 <= h ? q >= -r ? q <= r ? (g = 1 / p, h *= g, q *= g, a = h * (h + a * q + 2 * b) + q * (a * h + q + 2 * k) + l) : (q = g, h = Math.max(0, -(a * q + b)), a = -h * h + q * (q + 2 * k) + l) : (q = -g, h = Math.max(0, -(a * q + b)), a = -h * h + q * (q + 2 * k) + l) : q <= -r ? (h = Math.max(0, -(-a * g + b)), q = 0 < h ? -g : Math.min(Math.max(-g, -k), g), a = -h * h + q * (q + 2 * k) + l) : q <= r ? (h = 0, q = Math.min(Math.max(-g, -k), g), a = q * (q + 2 * k) + l) : (h = Math.max(0, -(a * g + b)), q = 0 < h ? g : Math.min(Math.max(-g, -k), g), a = -h * h + q * (q + 2 * k) + l)) : (q = 0 < a ? -g : g, h = Math.max(0, -(a * q + b)), a = -h * h + q * (q + 2 * k) + l);
        c && c.copy(this.direction.clone().multiplyScalar(h).add(this.origin));
        d && d.copy(f.clone().multiplyScalar(q).add(e));
        return a
    },
    isIntersectionSphere: function(a) {
        return this.distanceToPoint(a.center) <= a.radius
    },
    intersectSphere: function() {
        var a = new THREE.Vector3;
        return function(b, c) {
            a.subVectors(b.center, this.origin);
            var d = a.dot(this.direction),
                e = a.dot(a) - d * d,
                f = b.radius * b.radius;
            if (e > f) return null;
            f = Math.sqrt(f - e);
            e = d - f;
            d += f;
            return 0 > e && 0 > d ? null : 0 > e ? this.at(d, c) : this.at(e, c)
        }
    }(),
    isIntersectionPlane: function(a) {
        var b = a.distanceToPoint(this.origin);
        return 0 === b || 0 > a.normal.dot(this.direction) * b ? !0 : !1
    },
    distanceToPlane: function(a) {
        var b = a.normal.dot(this.direction);
        if (0 == b) return 0 == a.distanceToPoint(this.origin) ? 0 : null;
        a = -(this.origin.dot(a.normal) + a.constant) / b;
        return 0 <= a ? a : null
    },
    intersectPlane: function(a, b) {
        var c = this.distanceToPlane(a);
        return null === c ? null : this.at(c, b)
    },
    isIntersectionBox: function() {
        var a = new THREE.Vector3;
        return function(b) {
            return null !== this.intersectBox(b, a)
        }
    }(),
    intersectBox: function(a, b) {
        var c, d, e, f, g;
        d = 1 / this.direction.x;
        f = 1 / this.direction.y;
        g = 1 / this.direction.z;
        var h = this.origin;
        0 <= d ? (c = (a.min.x - h.x) * d, d *= a.max.x - h.x) : (c = (a.max.x - h.x) * d, d *= a.min.x - h.x);
        0 <= f ? (e = (a.min.y - h.y) * f, f *= a.max.y - h.y) : (e = (a.max.y - h.y) * f, f *= a.min.y - h.y);
        if (c > f || e > d) return null;
        if (e > c || c !== c) c = e;
        if (f < d || d !== d) d = f;
        0 <= g ? (e = (a.min.z - h.z) * g, g *= a.max.z - h.z) : (e = (a.max.z - h.z) * g, g *= a.min.z - h.z);
        if (c > g || e > d) return null;
        if (e > c || c !==
            c) c = e;
        if (g < d || d !== d) d = g;
        return 0 > d ? null : this.at(0 <= c ? c : d, b)
    },
    intersectTriangle: function() {
        var a = new THREE.Vector3,
            b = new THREE.Vector3,
            c = new THREE.Vector3,
            d = new THREE.Vector3;
        return function(e, f, g, h, k) {
            b.subVectors(f, e);
            c.subVectors(g, e);
            d.crossVectors(b, c);
            f = this.direction.dot(d);
            if (0 < f) {
                if (h) return null;
                h = 1
            } else if (0 > f) h = -1, f = -f;
            else return null;
            a.subVectors(this.origin, e);
            e = h * this.direction.dot(c.crossVectors(a, c));
            if (0 > e) return null;
            g = h * this.direction.dot(b.cross(a));
            if (0 > g || e + g > f) return null;
            e = -h * a.dot(d);
            return 0 > e ? null : this.at(e / f, k)
        }
    }(),
    applyMatrix4: function(a) {
        this.direction.add(this.origin).applyMatrix4(a);
        this.origin.applyMatrix4(a);
        this.direction.sub(this.origin);
        this.direction.normalize();
        return this
    },
    equals: function(a) {
        return a.origin.equals(this.origin) && a.direction.equals(this.direction)
    },
    clone: function() {
        return (new THREE.Ray).copy(this)
    }
};
THREE.Sphere = function(a, b) {
    this.center = void 0 !== a ? a : new THREE.Vector3;
    this.radius = void 0 !== b ? b : 0
};
THREE.Sphere.prototype = {
    constructor: THREE.Sphere,
    set: function(a, b) {
        this.center.copy(a);
        this.radius = b;
        return this
    },
    setFromPoints: function() {
        var a = new THREE.Box3;
        return function(b, c) {
            var d = this.center;
            void 0 !== c ? d.copy(c) : a.setFromPoints(b).center(d);
            for (var e = 0, f = 0, g = b.length; f < g; f++) e = Math.max(e, d.distanceToSquared(b[f]));
            this.radius = Math.sqrt(e);
            return this
        }
    }(),
    copy: function(a) {
        this.center.copy(a.center);
        this.radius = a.radius;
        return this
    },
    empty: function() {
        return 0 >= this.radius
    },
    containsPoint: function(a) {
        return a.distanceToSquared(this.center) <=
            this.radius * this.radius
    },
    distanceToPoint: function(a) {
        return a.distanceTo(this.center) - this.radius
    },
    intersectsSphere: function(a) {
        var b = this.radius + a.radius;
        return a.center.distanceToSquared(this.center) <= b * b
    },
    clampPoint: function(a, b) {
        var c = this.center.distanceToSquared(a),
            d = b || new THREE.Vector3;
        d.copy(a);
        c > this.radius * this.radius && (d.sub(this.center).normalize(), d.multiplyScalar(this.radius).add(this.center));
        return d
    },
    getBoundingBox: function(a) {
        a = a || new THREE.Box3;
        a.set(this.center, this.center);
        a.expandByScalar(this.radius);
        return a
    },
    applyMatrix4: function(a) {
        this.center.applyMatrix4(a);
        this.radius *= a.getMaxScaleOnAxis();
        return this
    },
    translate: function(a) {
        this.center.add(a);
        return this
    },
    equals: function(a) {
        return a.center.equals(this.center) && a.radius === this.radius
    },
    clone: function() {
        return (new THREE.Sphere).copy(this)
    }
};
THREE.Frustum = function(a, b, c, d, e, f) {
    this.planes = [void 0 !== a ? a : new THREE.Plane, void 0 !== b ? b : new THREE.Plane, void 0 !== c ? c : new THREE.Plane, void 0 !== d ? d : new THREE.Plane, void 0 !== e ? e : new THREE.Plane, void 0 !== f ? f : new THREE.Plane]
};
THREE.Frustum.prototype = {
    constructor: THREE.Frustum,
    set: function(a, b, c, d, e, f) {
        var g = this.planes;
        g[0].copy(a);
        g[1].copy(b);
        g[2].copy(c);
        g[3].copy(d);
        g[4].copy(e);
        g[5].copy(f);
        return this
    },
    copy: function(a) {
        for (var b = this.planes, c = 0; 6 > c; c++) b[c].copy(a.planes[c]);
        return this
    },
    setFromMatrix: function(a) {
        var b = this.planes,
            c = a.elements;
        a = c[0];
        var d = c[1],
            e = c[2],
            f = c[3],
            g = c[4],
            h = c[5],
            k = c[6],
            l = c[7],
            p = c[8],
            q = c[9],
            r = c[10],
            t = c[11],
            s = c[12],
            n = c[13],
            v = c[14],
            c = c[15];
        b[0].setComponents(f - a, l - g, t - p, c - s).normalize();
        b[1].setComponents(f +
            a, l + g, t + p, c + s).normalize();
        b[2].setComponents(f + d, l + h, t + q, c + n).normalize();
        b[3].setComponents(f - d, l - h, t - q, c - n).normalize();
        b[4].setComponents(f - e, l - k, t - r, c - v).normalize();
        b[5].setComponents(f + e, l + k, t + r, c + v).normalize();
        return this
    },
    intersectsObject: function() {
        var a = new THREE.Sphere;
        return function(b) {
            var c = b.geometry;
            null === c.boundingSphere && c.computeBoundingSphere();
            a.copy(c.boundingSphere);
            a.applyMatrix4(b.matrixWorld);
            return this.intersectsSphere(a)
        }
    }(),
    intersectsSphere: function(a) {
        var b = this.planes,
            c = a.center;
        a = -a.radius;
        for (var d = 0; 6 > d; d++)
            if (b[d].distanceToPoint(c) < a) return !1;
        return !0
    },
    intersectsBox: function() {
        var a = new THREE.Vector3,
            b = new THREE.Vector3;
        return function(c) {
            for (var d = this.planes, e = 0; 6 > e; e++) {
                var f = d[e];
                a.x = 0 < f.normal.x ? c.min.x : c.max.x;
                b.x = 0 < f.normal.x ? c.max.x : c.min.x;
                a.y = 0 < f.normal.y ? c.min.y : c.max.y;
                b.y = 0 < f.normal.y ? c.max.y : c.min.y;
                a.z = 0 < f.normal.z ? c.min.z : c.max.z;
                b.z = 0 < f.normal.z ? c.max.z : c.min.z;
                var g = f.distanceToPoint(a),
                    f = f.distanceToPoint(b);
                if (0 > g && 0 > f) return !1
            }
            return !0
        }
    }(),
    containsPoint: function(a) {
        for (var b = this.planes, c = 0; 6 > c; c++)
            if (0 > b[c].distanceToPoint(a)) return !1;
        return !0
    },
    clone: function() {
        return (new THREE.Frustum).copy(this)
    }
};
THREE.Plane = function(a, b) {
    this.normal = void 0 !== a ? a : new THREE.Vector3(1, 0, 0);
    this.constant = void 0 !== b ? b : 0
};
THREE.Plane.prototype = {
    constructor: THREE.Plane,
    set: function(a, b) {
        this.normal.copy(a);
        this.constant = b;
        return this
    },
    setComponents: function(a, b, c, d) {
        this.normal.set(a, b, c);
        this.constant = d;
        return this
    },
    setFromNormalAndCoplanarPoint: function(a, b) {
        this.normal.copy(a);
        this.constant = -b.dot(this.normal);
        return this
    },
    setFromCoplanarPoints: function() {
        var a = new THREE.Vector3,
            b = new THREE.Vector3;
        return function(c, d, e) {
            d = a.subVectors(e, d).cross(b.subVectors(c, d)).normalize();
            this.setFromNormalAndCoplanarPoint(d,
                c);
            return this
        }
    }(),
    copy: function(a) {
        this.normal.copy(a.normal);
        this.constant = a.constant;
        return this
    },
    normalize: function() {
        var a = 1 / this.normal.length();
        this.normal.multiplyScalar(a);
        this.constant *= a;
        return this
    },
    negate: function() {
        this.constant *= -1;
        this.normal.negate();
        return this
    },
    distanceToPoint: function(a) {
        return this.normal.dot(a) + this.constant
    },
    distanceToSphere: function(a) {
        return this.distanceToPoint(a.center) - a.radius
    },
    projectPoint: function(a, b) {
        return this.orthoPoint(a, b).sub(a).negate()
    },
    orthoPoint: function(a,
        b) {
        var c = this.distanceToPoint(a);
        return (b || new THREE.Vector3).copy(this.normal).multiplyScalar(c)
    },
    isIntersectionLine: function(a) {
        var b = this.distanceToPoint(a.start);
        a = this.distanceToPoint(a.end);
        return 0 > b && 0 < a || 0 > a && 0 < b
    },
    intersectLine: function() {
        var a = new THREE.Vector3;
        return function(b, c) {
            var d = c || new THREE.Vector3,
                e = b.delta(a),
                f = this.normal.dot(e);
            if (0 == f) {
                if (0 == this.distanceToPoint(b.start)) return d.copy(b.start)
            } else return f = -(b.start.dot(this.normal) + this.constant) / f, 0 > f || 1 < f ? void 0 : d.copy(e).multiplyScalar(f).add(b.start)
        }
    }(),
    coplanarPoint: function(a) {
        return (a || new THREE.Vector3).copy(this.normal).multiplyScalar(-this.constant)
    },
    applyMatrix4: function() {
        var a = new THREE.Vector3,
            b = new THREE.Vector3,
            c = new THREE.Matrix3;
        return function(d, e) {
            var f = e || c.getNormalMatrix(d),
                f = a.copy(this.normal).applyMatrix3(f),
                g = this.coplanarPoint(b);
            g.applyMatrix4(d);
            this.setFromNormalAndCoplanarPoint(f, g);
            return this
        }
    }(),
    translate: function(a) {
        this.constant -= a.dot(this.normal);
        return this
    },
    equals: function(a) {
        return a.normal.equals(this.normal) &&
            a.constant == this.constant
    },
    clone: function() {
        return (new THREE.Plane).copy(this)
    }
};
THREE.Math = {
    generateUUID: function() {
        var a = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".split(""),
            b = Array(36),
            c = 0,
            d;
        return function() {
            for (var e = 0; 36 > e; e++) 8 == e || 13 == e || 18 == e || 23 == e ? b[e] = "-" : 14 == e ? b[e] = "4" : (2 >= c && (c = 33554432 + 16777216 * Math.random() | 0), d = c & 15, c >>= 4, b[e] = a[19 == e ? d & 3 | 8 : d]);
            return b.join("")
        }
    }(),
    clamp: function(a, b, c) {
        return a < b ? b : a > c ? c : a
    },
    clampBottom: function(a, b) {
        return a < b ? b : a
    },
    mapLinear: function(a, b, c, d, e) {
        return d + (a - b) * (e - d) / (c - b)
    },
    smoothstep: function(a, b, c) {
        if (a <=
            b) return 0;
        if (a >= c) return 1;
        a = (a - b) / (c - b);
        return a * a * (3 - 2 * a)
    },
    smootherstep: function(a, b, c) {
        if (a <= b) return 0;
        if (a >= c) return 1;
        a = (a - b) / (c - b);
        return a * a * a * (a * (6 * a - 15) + 10)
    },
    random16: function() {
        return (65280 * Math.random() + 255 * Math.random()) / 65535
    },
    randInt: function(a, b) {
        return a + Math.floor(Math.random() * (b - a + 1))
    },
    randFloat: function(a, b) {
        return a + Math.random() * (b - a)
    },
    randFloatSpread: function(a) {
        return a * (0.5 - Math.random())
    },
    sign: function(a) {
        return 0 > a ? -1 : 0 < a ? 1 : 0
    },
    degToRad: function() {
        var a = Math.PI / 180;
        return function(b) {
            return b *
                a
        }
    }(),
    radToDeg: function() {
        var a = 180 / Math.PI;
        return function(b) {
            return b * a
        }
    }(),
    isPowerOfTwo: function(a) {
        return 0 === (a & a - 1) && 0 !== a
    }
};
THREE.Spline = function(a) {
    function b(a, b, c, d, e, f, g) {
        a = 0.5 * (c - a);
        d = 0.5 * (d - b);
        return (2 * (b - c) + a + d) * g + (-3 * (b - c) - 2 * a - d) * f + a * e + b
    }
    this.points = a;
    var c = [],
        d = {
            x: 0,
            y: 0,
            z: 0
        },
        e, f, g, h, k, l, p, q, r;
    this.initFromArray = function(a) {
        this.points = [];
        for (var b = 0; b < a.length; b++) this.points[b] = {
            x: a[b][0],
            y: a[b][1],
            z: a[b][2]
        }
    };
    this.getPoint = function(a) {
        e = (this.points.length - 1) * a;
        f = Math.floor(e);
        g = e - f;
        c[0] = 0 === f ? f : f - 1;
        c[1] = f;
        c[2] = f > this.points.length - 2 ? this.points.length - 1 : f + 1;
        c[3] = f > this.points.length - 3 ? this.points.length - 1 :
            f + 2;
        l = this.points[c[0]];
        p = this.points[c[1]];
        q = this.points[c[2]];
        r = this.points[c[3]];
        h = g * g;
        k = g * h;
        d.x = b(l.x, p.x, q.x, r.x, g, h, k);
        d.y = b(l.y, p.y, q.y, r.y, g, h, k);
        d.z = b(l.z, p.z, q.z, r.z, g, h, k);
        return d
    };
    this.getControlPointsArray = function() {
        var a, b, c = this.points.length,
            d = [];
        for (a = 0; a < c; a++) b = this.points[a], d[a] = [b.x, b.y, b.z];
        return d
    };
    this.getLength = function(a) {
        var b, c, d, e = b = b = 0,
            f = new THREE.Vector3,
            g = new THREE.Vector3,
            h = [],
            k = 0;
        h[0] = 0;
        a || (a = 100);
        c = this.points.length * a;
        f.copy(this.points[0]);
        for (a = 1; a < c; a++) b =
            a / c, d = this.getPoint(b), g.copy(d), k += g.distanceTo(f), f.copy(d), b *= this.points.length - 1, b = Math.floor(b), b != e && (h[b] = k, e = b);
        h[h.length] = k;
        return {
            chunks: h,
            total: k
        }
    };
    this.reparametrizeByArcLength = function(a) {
        var b, c, d, e, f, g, h = [],
            k = new THREE.Vector3,
            l = this.getLength();
        h.push(k.copy(this.points[0]).clone());
        for (b = 1; b < this.points.length; b++) {
            c = l.chunks[b] - l.chunks[b - 1];
            g = Math.ceil(a * c / l.total);
            e = (b - 1) / (this.points.length - 1);
            f = b / (this.points.length - 1);
            for (c = 1; c < g - 1; c++) d = e + 1 / g * c * (f - e), d = this.getPoint(d), h.push(k.copy(d).clone());
            h.push(k.copy(this.points[b]).clone())
        }
        this.points = h
    }
};
THREE.Triangle = function(a, b, c) {
    this.a = void 0 !== a ? a : new THREE.Vector3;
    this.b = void 0 !== b ? b : new THREE.Vector3;
    this.c = void 0 !== c ? c : new THREE.Vector3
};
THREE.Triangle.normal = function() {
    var a = new THREE.Vector3;
    return function(b, c, d, e) {
        e = e || new THREE.Vector3;
        e.subVectors(d, c);
        a.subVectors(b, c);
        e.cross(a);
        b = e.lengthSq();
        return 0 < b ? e.multiplyScalar(1 / Math.sqrt(b)) : e.set(0, 0, 0)
    }
}();
THREE.Triangle.barycoordFromPoint = function() {
    var a = new THREE.Vector3,
        b = new THREE.Vector3,
        c = new THREE.Vector3;
    return function(d, e, f, g, h) {
        a.subVectors(g, e);
        b.subVectors(f, e);
        c.subVectors(d, e);
        d = a.dot(a);
        e = a.dot(b);
        f = a.dot(c);
        var k = b.dot(b);
        g = b.dot(c);
        var l = d * k - e * e;
        h = h || new THREE.Vector3;
        if (0 == l) return h.set(-2, -1, -1);
        l = 1 / l;
        k = (k * f - e * g) * l;
        d = (d * g - e * f) * l;
        return h.set(1 - k - d, d, k)
    }
}();
THREE.Triangle.containsPoint = function() {
    var a = new THREE.Vector3;
    return function(b, c, d, e) {
        b = THREE.Triangle.barycoordFromPoint(b, c, d, e, a);
        return 0 <= b.x && 0 <= b.y && 1 >= b.x + b.y
    }
}();
THREE.Triangle.prototype = {
    constructor: THREE.Triangle,
    set: function(a, b, c) {
        this.a.copy(a);
        this.b.copy(b);
        this.c.copy(c);
        return this
    },
    setFromPointsAndIndices: function(a, b, c, d) {
        this.a.copy(a[b]);
        this.b.copy(a[c]);
        this.c.copy(a[d]);
        return this
    },
    copy: function(a) {
        this.a.copy(a.a);
        this.b.copy(a.b);
        this.c.copy(a.c);
        return this
    },
    area: function() {
        var a = new THREE.Vector3,
            b = new THREE.Vector3;
        return function() {
            a.subVectors(this.c, this.b);
            b.subVectors(this.a, this.b);
            return 0.5 * a.cross(b).length()
        }
    }(),
    midpoint: function(a) {
        return (a ||
            new THREE.Vector3).addVectors(this.a, this.b).add(this.c).multiplyScalar(1 / 3)
    },
    normal: function(a) {
        return THREE.Triangle.normal(this.a, this.b, this.c, a)
    },
    plane: function(a) {
        return (a || new THREE.Plane).setFromCoplanarPoints(this.a, this.b, this.c)
    },
    barycoordFromPoint: function(a, b) {
        return THREE.Triangle.barycoordFromPoint(a, this.a, this.b, this.c, b)
    },
    containsPoint: function(a) {
        return THREE.Triangle.containsPoint(a, this.a, this.b, this.c)
    },
    equals: function(a) {
        return a.a.equals(this.a) && a.b.equals(this.b) && a.c.equals(this.c)
    },
    clone: function() {
        return (new THREE.Triangle).copy(this)
    }
};
THREE.Clock = function(a) {
    this.autoStart = void 0 !== a ? a : !0;
    this.elapsedTime = this.oldTime = this.startTime = 0;
    this.running = !1
};
THREE.Clock.prototype = {
    constructor: THREE.Clock,
    start: function() {
        this.oldTime = this.startTime = void 0 !== self.performance && void 0 !== self.performance.now ? self.performance.now() : Date.now();
        this.running = !0
    },
    stop: function() {
        this.getElapsedTime();
        this.running = !1
    },
    getElapsedTime: function() {
        this.getDelta();
        return this.elapsedTime
    },
    getDelta: function() {
        var a = 0;
        this.autoStart && !this.running && this.start();
        if (this.running) {
            var b = void 0 !== self.performance && void 0 !== self.performance.now ? self.performance.now() : Date.now(),
                a = 0.001 * (b - this.oldTime);
            this.oldTime = b;
            this.elapsedTime += a
        }
        return a
    }
};
THREE.EventDispatcher = function() {};
THREE.EventDispatcher.prototype = {
    constructor: THREE.EventDispatcher,
    apply: function(a) {
        a.addEventListener = THREE.EventDispatcher.prototype.addEventListener;
        a.hasEventListener = THREE.EventDispatcher.prototype.hasEventListener;
        a.removeEventListener = THREE.EventDispatcher.prototype.removeEventListener;
        a.dispatchEvent = THREE.EventDispatcher.prototype.dispatchEvent
    },
    addEventListener: function(a, b) {
        void 0 === this._listeners && (this._listeners = {});
        var c = this._listeners;
        void 0 === c[a] && (c[a] = []); - 1 === c[a].indexOf(b) &&
            c[a].push(b)
    },
    hasEventListener: function(a, b) {
        if (void 0 === this._listeners) return !1;
        var c = this._listeners;
        return void 0 !== c[a] && -1 !== c[a].indexOf(b) ? !0 : !1
    },
    removeEventListener: function(a, b) {
        if (void 0 !== this._listeners) {
            var c = this._listeners[a];
            if (void 0 !== c) {
                var d = c.indexOf(b); - 1 !== d && c.splice(d, 1)
            }
        }
    },
    dispatchEvent: function(a) {
        if (void 0 !== this._listeners) {
            var b = this._listeners[a.type];
            if (void 0 !== b) {
                a.target = this;
                for (var c = [], d = b.length, e = 0; e < d; e++) c[e] = b[e];
                for (e = 0; e < d; e++) c[e].call(this, a)
            }
        }
    }
};
(function(a) {
    a.Raycaster = function(b, c, f, g) {
        this.ray = new a.Ray(b, c);
        this.near = f || 0;
        this.far = g || Infinity;
        this.params = {
            Sprite: {},
            Mesh: {},
            PointCloud: {
                threshold: 1
            },
            LOD: {},
            Line: {}
        }
    };
    var b = function(a, b) {
            return a.distance - b.distance
        },
        c = function(a, b, f, g) {
            a.raycast(b, f);
            if (!0 === g) {
                a = a.children;
                g = 0;
                for (var h = a.length; g < h; g++) c(a[g], b, f, !0)
            }
        };
    a.Raycaster.prototype = {
        constructor: a.Raycaster,
        precision: 1E-4,
        linePrecision: 1,
        set: function(a, b) {
            this.ray.set(a, b)
        },
        intersectObject: function(a, e) {
            var f = [];
            c(a, this, f, e);
            f.sort(b);
            return f
        },
        intersectObjects: function(a, e) {
            for (var f = [], g = 0, h = a.length; g < h; g++) c(a[g], this, f, e);
            f.sort(b);
            return f
        }
    }
})(THREE);
THREE.Object3D = function() {
    this.id = THREE.Object3DIdCount++;
    this.uuid = THREE.Math.generateUUID();
    this.name = "";
    this.parent = void 0;
    this.children = [];
    this.up = THREE.Object3D.DefaultUp.clone();
    var a = new THREE.Vector3,
        b = new THREE.Euler,
        c = new THREE.Quaternion,
        d = new THREE.Vector3(1, 1, 1);
    b.onChange(function() {
        c.setFromEuler(b, !1)
    });
    c.onChange(function() {
        b.setFromQuaternion(c, void 0, !1)
    });
    Object.defineProperties(this, {
        position: {
            enumerable: !0,
            value: a
        },
        rotation: {
            enumerable: !0,
            value: b
        },
        quaternion: {
            enumerable: !0,
            value: c
        },
        scale: {
            enumerable: !0,
            value: d
        }
    });
    this.renderDepth = null;
    this.rotationAutoUpdate = !0;
    this.matrix = new THREE.Matrix4;
    this.matrixWorld = new THREE.Matrix4;
    this.matrixAutoUpdate = !0;
    this.matrixWorldNeedsUpdate = !1;
    this.visible = !0;
    this.receiveShadow = this.castShadow = !1;
    this.frustumCulled = !0;
    this.userData = {}
};
THREE.Object3D.DefaultUp = new THREE.Vector3(0, 1, 0);
THREE.Object3D.prototype = {
    constructor: THREE.Object3D,
    get eulerOrder() {
        console.warn("THREE.Object3D: .eulerOrder has been moved to .rotation.order.");
        return this.rotation.order
    },
    set eulerOrder(a) {
        console.warn("THREE.Object3D: .eulerOrder has been moved to .rotation.order.");
        this.rotation.order = a
    },
    get useQuaternion() {
        console.warn("THREE.Object3D: .useQuaternion has been removed. The library now uses quaternions by default.")
    },
    set useQuaternion(a) {
        console.warn("THREE.Object3D: .useQuaternion has been removed. The library now uses quaternions by default.")
    },
    applyMatrix: function(a) {
        this.matrix.multiplyMatrices(a, this.matrix);
        this.matrix.decompose(this.position, this.quaternion, this.scale)
    },
    setRotationFromAxisAngle: function(a, b) {
        this.quaternion.setFromAxisAngle(a, b)
    },
    setRotationFromEuler: function(a) {
        this.quaternion.setFromEuler(a, !0)
    },
    setRotationFromMatrix: function(a) {
        this.quaternion.setFromRotationMatrix(a)
    },
    setRotationFromQuaternion: function(a) {
        this.quaternion.copy(a)
    },
    rotateOnAxis: function() {
        var a = new THREE.Quaternion;
        return function(b, c) {
            a.setFromAxisAngle(b,
                c);
            this.quaternion.multiply(a);
            return this
        }
    }(),
    rotateX: function() {
        var a = new THREE.Vector3(1, 0, 0);
        return function(b) {
            return this.rotateOnAxis(a, b)
        }
    }(),
    rotateY: function() {
        var a = new THREE.Vector3(0, 1, 0);
        return function(b) {
            return this.rotateOnAxis(a, b)
        }
    }(),
    rotateZ: function() {
        var a = new THREE.Vector3(0, 0, 1);
        return function(b) {
            return this.rotateOnAxis(a, b)
        }
    }(),
    translateOnAxis: function() {
        var a = new THREE.Vector3;
        return function(b, c) {
            a.copy(b).applyQuaternion(this.quaternion);
            this.position.add(a.multiplyScalar(c));
            return this
        }
    }(),
    translate: function(a, b) {
        console.warn("THREE.Object3D: .translate() has been removed. Use .translateOnAxis( axis, distance ) instead.");
        return this.translateOnAxis(b, a)
    },
    translateX: function() {
        var a = new THREE.Vector3(1, 0, 0);
        return function(b) {
            return this.translateOnAxis(a, b)
        }
    }(),
    translateY: function() {
        var a = new THREE.Vector3(0, 1, 0);
        return function(b) {
            return this.translateOnAxis(a, b)
        }
    }(),
    translateZ: function() {
        var a = new THREE.Vector3(0, 0, 1);
        return function(b) {
            return this.translateOnAxis(a,
                b)
        }
    }(),
    localToWorld: function(a) {
        return a.applyMatrix4(this.matrixWorld)
    },
    worldToLocal: function() {
        var a = new THREE.Matrix4;
        return function(b) {
            return b.applyMatrix4(a.getInverse(this.matrixWorld))
        }
    }(),
    lookAt: function() {
        var a = new THREE.Matrix4;
        return function(b) {
            a.lookAt(b, this.position, this.up);
            this.quaternion.setFromRotationMatrix(a)
        }
    }(),
    add: function(a) {
        if (a === this) console.warn("THREE.Object3D.add: An object can't be added as a child of itself.");
        else if (a instanceof THREE.Object3D) {
            void 0 !== a.parent &&
                a.parent.remove(a);
            a.parent = this;
            a.dispatchEvent({
                type: "added"
            });
            this.children.push(a);
            for (var b = this; void 0 !== b.parent;) b = b.parent;
            void 0 !== b && b instanceof THREE.Scene && b.__addObject(a)
        }
    },
    remove: function(a) {
        var b = this.children.indexOf(a);
        if (-1 !== b) {
            a.parent = void 0;
            a.dispatchEvent({
                type: "removed"
            });
            this.children.splice(b, 1);
            for (b = this; void 0 !== b.parent;) b = b.parent;
            void 0 !== b && b instanceof THREE.Scene && b.__removeObject(a)
        }
    },
    raycast: function() {},
    traverse: function(a) {
        a(this);
        for (var b = 0, c = this.children.length; b <
            c; b++) this.children[b].traverse(a)
    },
    getObjectById: function(a, b) {
        for (var c = 0, d = this.children.length; c < d; c++) {
            var e = this.children[c];
            if (e.id === a || !0 === b && (e = e.getObjectById(a, b), void 0 !== e)) return e
        }
    },
    getObjectByName: function(a, b) {
        for (var c = 0, d = this.children.length; c < d; c++) {
            var e = this.children[c];
            if (e.name === a || !0 === b && (e = e.getObjectByName(a, b), void 0 !== e)) return e
        }
    },
    getChildByName: function(a, b) {
        console.warn("THREE.Object3D: .getChildByName() has been renamed to .getObjectByName().");
        return this.getObjectByName(a,
            b)
    },
    updateMatrix: function() {
        this.matrix.compose(this.position, this.quaternion, this.scale);
        this.matrixWorldNeedsUpdate = !0
    },
    updateMatrixWorld: function(a) {
        !0 === this.matrixAutoUpdate && this.updateMatrix();
        if (!0 === this.matrixWorldNeedsUpdate || !0 === a) void 0 === this.parent ? this.matrixWorld.copy(this.matrix) : this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix), this.matrixWorldNeedsUpdate = !1, a = !0;
        for (var b = 0, c = this.children.length; b < c; b++) this.children[b].updateMatrixWorld(a)
    },
    clone: function(a,
        b) {
        void 0 === a && (a = new THREE.Object3D);
        void 0 === b && (b = !0);
        a.name = this.name;
        a.up.copy(this.up);
        a.position.copy(this.position);
        a.quaternion.copy(this.quaternion);
        a.scale.copy(this.scale);
        a.renderDepth = this.renderDepth;
        a.rotationAutoUpdate = this.rotationAutoUpdate;
        a.matrix.copy(this.matrix);
        a.matrixWorld.copy(this.matrixWorld);
        a.matrixAutoUpdate = this.matrixAutoUpdate;
        a.matrixWorldNeedsUpdate = this.matrixWorldNeedsUpdate;
        a.visible = this.visible;
        a.castShadow = this.castShadow;
        a.receiveShadow = this.receiveShadow;
        a.frustumCulled = this.frustumCulled;
        a.userData = JSON.parse(JSON.stringify(this.userData));
        if (!0 === b)
            for (var c = 0; c < this.children.length; c++) a.add(this.children[c].clone());
        return a
    }
};
THREE.EventDispatcher.prototype.apply(THREE.Object3D.prototype);
THREE.Object3DIdCount = 0;
THREE.Projector = function() {
    function a() {
        if (p === r) {
            var a = new THREE.RenderableVertex;
            q.push(a);
            r++;
            p++;
            return a
        }
        return q[p++]
    }

    function b() {
        if (s === v) {
            var a = new THREE.RenderableFace;
            n.push(a);
            v++;
            s++;
            return a
        }
        return n[s++]
    }

    function c() {
        if (u === K) {
            var a = new THREE.RenderableLine;
            x.push(a);
            K++;
            u++;
            return a
        }
        return x[u++]
    }

    function d(a, b) {
        return a.z !== b.z ? b.z - a.z : a.id !== b.id ? a.id - b.id : 0
    }

    function e(a, b) {
        var c = 0,
            d = 1,
            e = a.z + a.w,
            f = b.z + b.w,
            g = -a.z + a.w,
            h = -b.z + b.w;
        if (0 <= e && 0 <= f && 0 <= g && 0 <= h) return !0;
        if (0 > e && 0 > f || 0 > g &&
            0 > h) return !1;
        0 > e ? c = Math.max(c, e / (e - f)) : 0 > f && (d = Math.min(d, e / (e - f)));
        0 > g ? c = Math.max(c, g / (g - h)) : 0 > h && (d = Math.min(d, g / (g - h)));
        if (d < c) return !1;
        a.lerp(b, c);
        b.lerp(a, 1 - d);
        return !0
    }
    var f, g, h = [],
        k = 0,
        l, p, q = [],
        r = 0,
        t, s, n = [],
        v = 0,
        w, u, x = [],
        K = 0,
        A, G, B = [],
        C = 0,
        E = {
            objects: [],
            lights: [],
            elements: []
        },
        H = new THREE.Vector3,
        y = new THREE.Vector3,
        Q = new THREE.Vector3,
        z = new THREE.Vector3,
        R = new THREE.Vector4,
        L = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1)),
        I = new THREE.Box3,
        F = Array(3),
        P = new THREE.Matrix4,
        X =
        new THREE.Matrix4,
        N, la = new THREE.Matrix4,
        S = new THREE.Matrix3,
        W = new THREE.Frustum,
        D = new THREE.Vector4,
        ha = new THREE.Vector4;
    this.projectVector = function(a, b) {
        b.matrixWorldInverse.getInverse(b.matrixWorld);
        X.multiplyMatrices(b.projectionMatrix, b.matrixWorldInverse);
        return a.applyProjection(X)
    };
    this.unprojectVector = function() {
        var a = new THREE.Matrix4;
        return function(b, c) {
            a.getInverse(c.projectionMatrix);
            X.multiplyMatrices(c.matrixWorld, a);
            return b.applyProjection(X)
        }
    }();
    this.pickingRay = function(a, b) {
        a.z = -1;
        var c = new THREE.Vector3(a.x, a.y, 1);
        this.unprojectVector(a, b);
        this.unprojectVector(c, b);
        c.sub(a).normalize();
        return new THREE.Raycaster(a, c)
    };
    var fa = function(a) {
            if (!1 !== a.visible) {
                if (a instanceof THREE.Light) E.lights.push(a);
                else if (a instanceof THREE.Mesh || a instanceof THREE.Line || a instanceof THREE.Sprite)
                    if (!1 === a.frustumCulled || !0 === W.intersectsObject(a)) {
                        if (g === k) {
                            var b = new THREE.RenderableObject;
                            h.push(b);
                            k++;
                            g++;
                            f = b
                        } else f = h[g++];
                        f.id = a.id;
                        f.object = a;
                        null !== a.renderDepth ? f.z = a.renderDepth :
                            (z.setFromMatrixPosition(a.matrixWorld), z.applyProjection(X), f.z = z.z);
                        E.objects.push(f)
                    }
                for (var b = 0, c = a.children.length; b < c; b++) fa(a.children[b])
            }
        },
        U = new function() {
            var d = [],
                e = [],
                f = null,
                g = null,
                h = new THREE.Matrix3,
                k = function(a) {
                    var b = a.positionWorld,
                        c = a.positionScreen;
                    b.copy(a.position).applyMatrix4(N);
                    c.copy(b).applyMatrix4(X);
                    b = 1 / c.w;
                    c.x *= b;
                    c.y *= b;
                    c.z *= b;
                    a.visible = -1 <= c.x && 1 >= c.x && -1 <= c.y && 1 >= c.y && -1 <= c.z && 1 >= c.z
                },
                p = function(a, b, c) {
                    if (!0 === a.visible || !0 === b.visible || !0 === c.visible) return !0;
                    F[0] =
                        a.positionScreen;
                    F[1] = b.positionScreen;
                    F[2] = c.positionScreen;
                    return L.isIntersectionBox(I.setFromPoints(F))
                },
                r = function(a, b, c) {
                    return 0 > (c.positionScreen.x - a.positionScreen.x) * (b.positionScreen.y - a.positionScreen.y) - (c.positionScreen.y - a.positionScreen.y) * (b.positionScreen.x - a.positionScreen.x)
                };
            return {
                setObject: function(a) {
                    f = a;
                    g = f.material;
                    h.getNormalMatrix(f.matrixWorld);
                    d.length = 0;
                    e.length = 0
                },
                projectVertex: k,
                checkTriangleVisibility: p,
                checkBackfaceCulling: r,
                pushVertex: function(b, c, d) {
                    l = a();
                    l.position.set(b,
                        c, d);
                    k(l)
                },
                pushNormal: function(a, b, c) {
                    d.push(a, b, c)
                },
                pushUv: function(a, b) {
                    e.push(a, b)
                },
                pushLine: function(a, b) {
                    var d = q[a],
                        e = q[b];
                    w = c();
                    w.id = f.id;
                    w.v1.copy(d);
                    w.v2.copy(e);
                    w.z = (d.positionScreen.z + e.positionScreen.z) / 2;
                    w.material = f.material;
                    E.elements.push(w)
                },
                pushTriangle: function(a, c, k) {
                    var l = q[a],
                        s = q[c],
                        n = q[k];
                    if (!1 !== p(l, s, n) && (g.side === THREE.DoubleSide || !0 === r(l, s, n))) {
                        t = b();
                        t.id = f.id;
                        t.v1.copy(l);
                        t.v2.copy(s);
                        t.v3.copy(n);
                        t.z = (l.positionScreen.z + s.positionScreen.z + n.positionScreen.z) / 3;
                        for (l = 0; 3 >
                            l; l++) s = 3 * arguments[l], n = t.vertexNormalsModel[l], n.set(d[s], d[s + 1], d[s + 2]), n.applyMatrix3(h).normalize(), s = 2 * arguments[l], t.uvs[l].set(e[s], e[s + 1]);
                        t.vertexNormalsLength = 3;
                        t.material = f.material;
                        E.elements.push(t)
                    }
                }
            }
        };
    this.projectScene = function(f, h, k, l) {
        var r, n, v, x, K, I, F, L;
        G = u = s = 0;
        E.elements.length = 0;
        !0 === f.autoUpdate && f.updateMatrixWorld();
        void 0 === h.parent && h.updateMatrixWorld();
        P.copy(h.matrixWorldInverse.getInverse(h.matrixWorld));
        X.multiplyMatrices(h.projectionMatrix, P);
        W.setFromMatrix(X);
        g = 0;
        E.objects.length = 0;
        E.lights.length = 0;
        fa(f);
        !0 === k && E.objects.sort(d);
        f = 0;
        for (k = E.objects.length; f < k; f++)
            if (r = E.objects[f].object, n = r.geometry, U.setObject(r), N = r.matrixWorld, p = 0, r instanceof THREE.Mesh)
                if (n instanceof THREE.BufferGeometry) {
                    if (I = n.attributes, r = n.offsets, void 0 !== I.position) {
                        F = I.position.array;
                        n = 0;
                        for (x = F.length; n < x; n += 3) U.pushVertex(F[n], F[n + 1], F[n + 2]);
                        if (void 0 !== I.normal)
                            for (L = I.normal.array, n = 0, x = L.length; n < x; n += 3) U.pushNormal(L[n], L[n + 1], L[n + 2]);
                        if (void 0 !== I.uv)
                            for (L = I.uv.array,
                                n = 0, x = L.length; n < x; n += 2) U.pushUv(L[n], L[n + 1]);
                        if (void 0 !== I.index)
                            if (I = I.index.array, 0 < r.length)
                                for (f = 0; f < r.length; f++)
                                    for (x = r[f], F = x.index, n = x.start, x = x.start + x.count; n < x; n += 3) U.pushTriangle(I[n] + F, I[n + 1] + F, I[n + 2] + F);
                            else
                                for (n = 0, x = I.length; n < x; n += 3) U.pushTriangle(I[n], I[n + 1], I[n + 2]);
                        else
                            for (n = 0, x = F.length / 3; n < x; n += 3) U.pushTriangle(n, n + 1, n + 2)
                    }
                } else {
                    if (n instanceof THREE.Geometry) {
                        v = n.vertices;
                        x = n.faces;
                        I = n.faceVertexUvs[0];
                        S.getNormalMatrix(N);
                        F = r.material instanceof THREE.MeshFaceMaterial;
                        L = !0 ===
                            F ? r.material : null;
                        for (var z = 0, Ja = v.length; z < Ja; z++) {
                            var ja = v[z];
                            U.pushVertex(ja.x, ja.y, ja.z)
                        }
                        z = 0;
                        for (Ja = x.length; z < Ja; z++) {
                            v = x[z];
                            var za = !0 === F ? L.materials[v.materialIndex] : r.material;
                            if (void 0 !== za) {
                                var ca = za.side,
                                    ja = q[v.a],
                                    ma = q[v.b],
                                    oa = q[v.c];
                                if (!0 === za.morphTargets) {
                                    K = n.morphTargets;
                                    var ua = r.morphTargetInfluences,
                                        Da = ja.position,
                                        Ka = ma.position,
                                        Fa = oa.position;
                                    H.set(0, 0, 0);
                                    y.set(0, 0, 0);
                                    Q.set(0, 0, 0);
                                    for (var ea = 0, va = K.length; ea < va; ea++) {
                                        var Ia = ua[ea];
                                        if (0 !== Ia) {
                                            var ta = K[ea].vertices;
                                            H.x += (ta[v.a].x -
                                                Da.x) * Ia;
                                            H.y += (ta[v.a].y - Da.y) * Ia;
                                            H.z += (ta[v.a].z - Da.z) * Ia;
                                            y.x += (ta[v.b].x - Ka.x) * Ia;
                                            y.y += (ta[v.b].y - Ka.y) * Ia;
                                            y.z += (ta[v.b].z - Ka.z) * Ia;
                                            Q.x += (ta[v.c].x - Fa.x) * Ia;
                                            Q.y += (ta[v.c].y - Fa.y) * Ia;
                                            Q.z += (ta[v.c].z - Fa.z) * Ia
                                        }
                                    }
                                    ja.position.add(H);
                                    ma.position.add(y);
                                    oa.position.add(Q);
                                    U.projectVertex(ja);
                                    U.projectVertex(ma);
                                    U.projectVertex(oa)
                                }
                                if (!1 !== U.checkTriangleVisibility(ja, ma, oa)) {
                                    ua = U.checkBackfaceCulling(ja, ma, oa);
                                    if (ca !== THREE.DoubleSide) {
                                        if (ca === THREE.FrontSide && !1 === ua) continue;
                                        if (ca === THREE.BackSide && !0 ===
                                            ua) continue
                                    }
                                    t = b();
                                    t.id = r.id;
                                    t.v1.copy(ja);
                                    t.v2.copy(ma);
                                    t.v3.copy(oa);
                                    t.normalModel.copy(v.normal);
                                    !1 !== ua || ca !== THREE.BackSide && ca !== THREE.DoubleSide || t.normalModel.negate();
                                    t.normalModel.applyMatrix3(S).normalize();
                                    K = v.vertexNormals;
                                    Da = 0;
                                    for (Ka = Math.min(K.length, 3); Da < Ka; Da++) Fa = t.vertexNormalsModel[Da], Fa.copy(K[Da]), !1 !== ua || ca !== THREE.BackSide && ca !== THREE.DoubleSide || Fa.negate(), Fa.applyMatrix3(S).normalize();
                                    t.vertexNormalsLength = K.length;
                                    ca = I[z];
                                    if (void 0 !== ca)
                                        for (K = 0; 3 > K; K++) t.uvs[K].copy(ca[K]);
                                    t.color = v.color;
                                    t.material = za;
                                    t.z = (ja.positionScreen.z + ma.positionScreen.z + oa.positionScreen.z) / 3;
                                    E.elements.push(t)
                                }
                            }
                        }
                    }
                } else if (r instanceof THREE.Line)
            if (n instanceof THREE.BufferGeometry) {
                if (I = n.attributes, void 0 !== I.position) {
                    F = I.position.array;
                    n = 0;
                    for (x = F.length; n < x; n += 3) U.pushVertex(F[n], F[n + 1], F[n + 2]);
                    if (void 0 !== I.index)
                        for (I = I.index.array, n = 0, x = I.length; n < x; n += 2) U.pushLine(I[n], I[n + 1]);
                    else
                        for (I = r.type === THREE.LinePieces ? 2 : 1, n = 0, x = F.length / 3 - 1; n < x; n += I) U.pushLine(n, n + 1)
                }
            } else {
                if (n instanceof THREE.Geometry && (la.multiplyMatrices(X, N), v = r.geometry.vertices, 0 !== v.length))
                    for (ja = a(), ja.positionScreen.copy(v[0]).applyMatrix4(la), I = r.type === THREE.LinePieces ? 2 : 1, z = 1, Ja = v.length; z < Ja; z++) ja = a(), ja.positionScreen.copy(v[z]).applyMatrix4(la), 0 < (z + 1) % I || (ma = q[p - 2], D.copy(ja.positionScreen), ha.copy(ma.positionScreen), !0 === e(D, ha) && (D.multiplyScalar(1 / D.w), ha.multiplyScalar(1 / ha.w), w = c(), w.id = r.id, w.v1.positionScreen.copy(D), w.v2.positionScreen.copy(ha), w.z = Math.max(D.z, ha.z), w.material = r.material,
                        r.material.vertexColors === THREE.VertexColors && (w.vertexColors[0].copy(r.geometry.colors[z]), w.vertexColors[1].copy(r.geometry.colors[z - 1])), E.elements.push(w)))
            } else r instanceof THREE.Sprite && (R.set(N.elements[12], N.elements[13], N.elements[14], 1), R.applyMatrix4(X), n = 1 / R.w, R.z *= n, -1 <= R.z && 1 >= R.z && (G === C ? (x = new THREE.RenderableSprite, B.push(x), C++, G++, A = x) : A = B[G++], A.id = r.id, A.x = R.x * n, A.y = R.y * n, A.z = R.z, A.object = r, A.rotation = r.rotation, A.scale.x = r.scale.x * Math.abs(A.x - (R.x + h.projectionMatrix.elements[0]) /
            (R.w + h.projectionMatrix.elements[12])), A.scale.y = r.scale.y * Math.abs(A.y - (R.y + h.projectionMatrix.elements[5]) / (R.w + h.projectionMatrix.elements[13])), A.material = r.material, E.elements.push(A)));
        !0 === l && E.elements.sort(d);
        return E
    }
};
THREE.Face3 = function(a, b, c, d, e, f) {
    this.a = a;
    this.b = b;
    this.c = c;
    this.normal = d instanceof THREE.Vector3 ? d : new THREE.Vector3;
    this.vertexNormals = d instanceof Array ? d : [];
    this.color = e instanceof THREE.Color ? e : new THREE.Color;
    this.vertexColors = e instanceof Array ? e : [];
    this.vertexTangents = [];
    this.materialIndex = void 0 !== f ? f : 0
};
THREE.Face3.prototype = {
    constructor: THREE.Face3,
    clone: function() {
        var a = new THREE.Face3(this.a, this.b, this.c);
        a.normal.copy(this.normal);
        a.color.copy(this.color);
        a.materialIndex = this.materialIndex;
        for (var b = 0, c = this.vertexNormals.length; b < c; b++) a.vertexNormals[b] = this.vertexNormals[b].clone();
        b = 0;
        for (c = this.vertexColors.length; b < c; b++) a.vertexColors[b] = this.vertexColors[b].clone();
        b = 0;
        for (c = this.vertexTangents.length; b < c; b++) a.vertexTangents[b] = this.vertexTangents[b].clone();
        return a
    }
};
THREE.Face4 = function(a, b, c, d, e, f, g) {
    console.warn("THREE.Face4 has been removed. A THREE.Face3 will be created instead.");
    return new THREE.Face3(a, b, c, e, f, g)
};
THREE.BufferAttribute = function(a, b) {
    this.array = a;
    this.itemSize = b
};
THREE.BufferAttribute.prototype = {
    constructor: THREE.BufferAttribute,
    get length() {
        return this.array.length
    },
    set: function(a) {
        this.array.set(a);
        return this
    },
    setX: function(a, b) {
        this.array[a * this.itemSize] = b;
        return this
    },
    setY: function(a, b) {
        this.array[a * this.itemSize + 1] = b;
        return this
    },
    setZ: function(a, b) {
        this.array[a * this.itemSize + 2] = b;
        return this
    },
    setXY: function(a, b, c) {
        a *= this.itemSize;
        this.array[a] = b;
        this.array[a + 1] = c;
        return this
    },
    setXYZ: function(a, b, c, d) {
        a *= this.itemSize;
        this.array[a] = b;
        this.array[a + 1] =
            c;
        this.array[a + 2] = d;
        return this
    },
    setXYZW: function(a, b, c, d, e) {
        a *= this.itemSize;
        this.array[a] = b;
        this.array[a + 1] = c;
        this.array[a + 2] = d;
        this.array[a + 3] = e;
        return this
    }
};
THREE.Int8Attribute = function(a, b) {
    console.warn("THREE.Int8Attribute has been removed. Use THREE.BufferAttribute( array, itemSize ) instead.");
    return new THREE.BufferAttribute(a, b)
};
THREE.Uint8Attribute = function(a, b) {
    console.warn("THREE.Uint8Attribute has been removed. Use THREE.BufferAttribute( array, itemSize ) instead.");
    return new THREE.BufferAttribute(a, b)
};
THREE.Uint8ClampedAttribute = function(a, b) {
    console.warn("THREE.Uint8ClampedAttribute has been removed. Use THREE.BufferAttribute( array, itemSize ) instead.");
    return new THREE.BufferAttribute(a, b)
};
THREE.Int16Attribute = function(a, b) {
    console.warn("THREE.Int16Attribute has been removed. Use THREE.BufferAttribute( array, itemSize ) instead.");
    return new THREE.BufferAttribute(a, b)
};
THREE.Uint16Attribute = function(a, b) {
    console.warn("THREE.Uint16Attribute has been removed. Use THREE.BufferAttribute( array, itemSize ) instead.");
    return new THREE.BufferAttribute(a, b)
};
THREE.Int32Attribute = function(a, b) {
    console.warn("THREE.Int32Attribute has been removed. Use THREE.BufferAttribute( array, itemSize ) instead.");
    return new THREE.BufferAttribute(a, b)
};
THREE.Uint32Attribute = function(a, b) {
    console.warn("THREE.Uint32Attribute has been removed. Use THREE.BufferAttribute( array, itemSize ) instead.");
    return new THREE.BufferAttribute(a, b)
};
THREE.Float32Attribute = function(a, b) {
    console.warn("THREE.Float32Attribute has been removed. Use THREE.BufferAttribute( array, itemSize ) instead.");
    return new THREE.BufferAttribute(a, b)
};
THREE.Float64Attribute = function(a, b) {
    console.warn("THREE.Float64Attribute has been removed. Use THREE.BufferAttribute( array, itemSize ) instead.");
    return new THREE.BufferAttribute(a, b)
};
THREE.BufferGeometry = function() {
    this.id = THREE.GeometryIdCount++;
    this.uuid = THREE.Math.generateUUID();
    this.name = "";
    this.attributes = {};
    this.offsets = this.drawcalls = [];
    this.boundingSphere = this.boundingBox = null
};
THREE.BufferGeometry.prototype = {
    constructor: THREE.BufferGeometry,
    addAttribute: function(a, b, c) {
        !1 === b instanceof THREE.BufferAttribute ? (console.warn("THREE.BufferGeometry: .addAttribute() now expects ( name, attribute )."), this.attributes[a] = {
            array: b,
            itemSize: c
        }) : this.attributes[a] = b
    },
    getAttribute: function(a) {
        return this.attributes[a]
    },
    addDrawCall: function(a, b, c) {
        this.drawcalls.push({
            start: a,
            count: b,
            index: void 0 !== c ? c : 0
        })
    },
    applyMatrix: function(a) {
        var b = this.attributes.position;
        void 0 !== b && (a.applyToVector3Array(b.array),
            b.needsUpdate = !0);
        b = this.attributes.normal;
        void 0 !== b && ((new THREE.Matrix3).getNormalMatrix(a).applyToVector3Array(b.array), b.needsUpdate = !0)
    },
    fromGeometry: function(a, b) {
        b = b || {
            vertexColors: THREE.NoColors
        };
        var c = a.vertices,
            d = a.faces,
            e = a.faceVertexUvs,
            f = b.vertexColors,
            g = 0 < e[0].length,
            h = 3 == d[0].vertexNormals.length,
            k = new Float32Array(9 * d.length);
        this.addAttribute("position", new THREE.BufferAttribute(k, 3));
        var l = new Float32Array(9 * d.length);
        this.addAttribute("normal", new THREE.BufferAttribute(l, 3));
        if (f !==
            THREE.NoColors) {
            var p = new Float32Array(9 * d.length);
            this.addAttribute("color", new THREE.BufferAttribute(p, 3))
        }
        if (!0 === g) {
            var q = new Float32Array(6 * d.length);
            this.addAttribute("uvs", new THREE.BufferAttribute(q, 2))
        }
        for (var r = 0, t = 0, s = 0; r < d.length; r++, t += 6, s += 9) {
            var n = d[r],
                v = c[n.a],
                w = c[n.b],
                u = c[n.c];
            k[s] = v.x;
            k[s + 1] = v.y;
            k[s + 2] = v.z;
            k[s + 3] = w.x;
            k[s + 4] = w.y;
            k[s + 5] = w.z;
            k[s + 6] = u.x;
            k[s + 7] = u.y;
            k[s + 8] = u.z;
            !0 === h ? (v = n.vertexNormals[0], w = n.vertexNormals[1], u = n.vertexNormals[2], l[s] = v.x, l[s + 1] = v.y, l[s + 2] = v.z, l[s + 3] =
                w.x, l[s + 4] = w.y, l[s + 5] = w.z, l[s + 6] = u.x, l[s + 7] = u.y, l[s + 8] = u.z) : (v = n.normal, l[s] = v.x, l[s + 1] = v.y, l[s + 2] = v.z, l[s + 3] = v.x, l[s + 4] = v.y, l[s + 5] = v.z, l[s + 6] = v.x, l[s + 7] = v.y, l[s + 8] = v.z);
            f === THREE.FaceColors ? (n = n.color, p[s] = n.r, p[s + 1] = n.g, p[s + 2] = n.b, p[s + 3] = n.r, p[s + 4] = n.g, p[s + 5] = n.b, p[s + 6] = n.r, p[s + 7] = n.g, p[s + 8] = n.b) : f === THREE.VertexColors && (v = n.vertexColors[0], w = n.vertexColors[1], n = n.vertexColors[2], p[s] = v.r, p[s + 1] = v.g, p[s + 2] = v.b, p[s + 3] = w.r, p[s + 4] = w.g, p[s + 5] = w.b, p[s + 6] = n.r, p[s + 7] = n.g, p[s + 8] = n.b);
            !0 === g && (n = e[0][r][0],
                v = e[0][r][1], w = e[0][r][2], q[t] = n.x, q[t + 1] = n.y, q[t + 2] = v.x, q[t + 3] = v.y, q[t + 4] = w.x, q[t + 5] = w.y)
        }
        this.computeBoundingSphere();
        return this
    },
    computeBoundingBox: function() {
        null === this.boundingBox && (this.boundingBox = new THREE.Box3);
        var a = this.attributes.position.array;
        if (a) {
            var b = this.boundingBox;
            3 <= a.length && (b.min.x = b.max.x = a[0], b.min.y = b.max.y = a[1], b.min.z = b.max.z = a[2]);
            for (var c = 3, d = a.length; c < d; c += 3) {
                var e = a[c],
                    f = a[c + 1],
                    g = a[c + 2];
                e < b.min.x ? b.min.x = e : e > b.max.x && (b.max.x = e);
                f < b.min.y ? b.min.y = f : f > b.max.y &&
                    (b.max.y = f);
                g < b.min.z ? b.min.z = g : g > b.max.z && (b.max.z = g)
            }
        }
        if (void 0 === a || 0 === a.length) this.boundingBox.min.set(0, 0, 0), this.boundingBox.max.set(0, 0, 0);
        (isNaN(this.boundingBox.min.x) || isNaN(this.boundingBox.min.y) || isNaN(this.boundingBox.min.z)) && console.error('THREE.BufferGeometry.computeBoundingBox: Computed min/max have NaN values. The "position" attribute is likely to have NaN values.')
    },
    computeBoundingSphere: function() {
        var a = new THREE.Box3,
            b = new THREE.Vector3;
        return function() {
            null === this.boundingSphere &&
                (this.boundingSphere = new THREE.Sphere);
            var c = this.attributes.position.array;
            if (c) {
                a.makeEmpty();
                for (var d = this.boundingSphere.center, e = 0, f = c.length; e < f; e += 3) b.set(c[e], c[e + 1], c[e + 2]), a.expandByPoint(b);
                a.center(d);
                for (var g = 0, e = 0, f = c.length; e < f; e += 3) b.set(c[e], c[e + 1], c[e + 2]), g = Math.max(g, d.distanceToSquared(b));
                this.boundingSphere.radius = Math.sqrt(g);
                isNaN(this.boundingSphere.radius) && console.error('THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.')
            }
        }
    }(),
    computeFaceNormals: function() {},
    computeVertexNormals: function() {
        if (this.attributes.position) {
            var a, b, c, d;
            a = this.attributes.position.array.length;
            if (void 0 === this.attributes.normal) this.attributes.normal = {
                itemSize: 3,
                array: new Float32Array(a)
            };
            else
                for (a = 0, b = this.attributes.normal.array.length; a < b; a++) this.attributes.normal.array[a] = 0;
            var e = this.attributes.position.array,
                f = this.attributes.normal.array,
                g, h, k, l, p, q, r = new THREE.Vector3,
                t = new THREE.Vector3,
                s = new THREE.Vector3,
                n = new THREE.Vector3,
                v = new THREE.Vector3;
            if (this.attributes.index) {
                var w = this.attributes.index.array,
                    u = 0 < this.offsets.length ? this.offsets : [{
                        start: 0,
                        count: w.length,
                        index: 0
                    }];
                c = 0;
                for (d = u.length; c < d; ++c) {
                    b = u[c].start;
                    g = u[c].count;
                    var x = u[c].index;
                    a = b;
                    for (b += g; a < b; a += 3) g = x + w[a], h = x + w[a + 1], k = x + w[a + 2], l = e[3 * g], p = e[3 * g + 1], q = e[3 * g + 2], r.set(l, p, q), l = e[3 * h], p = e[3 * h + 1], q = e[3 * h + 2], t.set(l, p, q), l = e[3 * k], p = e[3 * k + 1], q = e[3 * k + 2], s.set(l, p, q), n.subVectors(s, t), v.subVectors(r, t), n.cross(v), f[3 * g] += n.x, f[3 * g + 1] += n.y, f[3 * g + 2] += n.z, f[3 * h] += n.x, f[3 * h + 1] += n.y,
                        f[3 * h + 2] += n.z, f[3 * k] += n.x, f[3 * k + 1] += n.y, f[3 * k + 2] += n.z
                }
            } else
                for (a = 0, b = e.length; a < b; a += 9) l = e[a], p = e[a + 1], q = e[a + 2], r.set(l, p, q), l = e[a + 3], p = e[a + 4], q = e[a + 5], t.set(l, p, q), l = e[a + 6], p = e[a + 7], q = e[a + 8], s.set(l, p, q), n.subVectors(s, t), v.subVectors(r, t), n.cross(v), f[a] = n.x, f[a + 1] = n.y, f[a + 2] = n.z, f[a + 3] = n.x, f[a + 4] = n.y, f[a + 5] = n.z, f[a + 6] = n.x, f[a + 7] = n.y, f[a + 8] = n.z;
            this.normalizeNormals();
            this.normalsNeedUpdate = !0
        }
    },
    computeTangents: function() {
        function a(a, b, c) {
            q = d[3 * a];
            r = d[3 * a + 1];
            t = d[3 * a + 2];
            s = d[3 * b];
            n = d[3 * b + 1];
            v = d[3 *
                b + 2];
            w = d[3 * c];
            u = d[3 * c + 1];
            x = d[3 * c + 2];
            K = f[2 * a];
            A = f[2 * a + 1];
            G = f[2 * b];
            B = f[2 * b + 1];
            C = f[2 * c];
            E = f[2 * c + 1];
            H = s - q;
            y = w - q;
            Q = n - r;
            z = u - r;
            R = v - t;
            L = x - t;
            I = G - K;
            F = C - K;
            P = B - A;
            X = E - A;
            N = 1 / (I * X - F * P);
            la.set((X * H - P * y) * N, (X * Q - P * z) * N, (X * R - P * L) * N);
            S.set((I * y - F * H) * N, (I * z - F * Q) * N, (I * L - F * R) * N);
            k[a].add(la);
            k[b].add(la);
            k[c].add(la);
            l[a].add(S);
            l[b].add(S);
            l[c].add(S)
        }

        function b(a) {
            xa.x = e[3 * a];
            xa.y = e[3 * a + 1];
            xa.z = e[3 * a + 2];
            Ca.copy(xa);
            Ea = k[a];
            wa.copy(Ea);
            wa.sub(xa.multiplyScalar(xa.dot(Ea))).normalize();
            ia.crossVectors(Ca, Ea);
            ba = ia.dot(l[a]);
            Ha = 0 > ba ? -1 : 1;
            h[4 * a] = wa.x;
            h[4 * a + 1] = wa.y;
            h[4 * a + 2] = wa.z;
            h[4 * a + 3] = Ha
        }
        if (void 0 === this.attributes.index || void 0 === this.attributes.position || void 0 === this.attributes.normal || void 0 === this.attributes.uv) console.warn("Missing required attributes (index, position, normal or uv) in BufferGeometry.computeTangents()");
        else {
            var c = this.attributes.index.array,
                d = this.attributes.position.array,
                e = this.attributes.normal.array,
                f = this.attributes.uv.array,
                g = d.length / 3;
            void 0 === this.attributes.tangent && (this.attributes.tangent = {
                itemSize: 4,
                array: new Float32Array(4 * g)
            });
            for (var h = this.attributes.tangent.array, k = [], l = [], p = 0; p < g; p++) k[p] = new THREE.Vector3, l[p] = new THREE.Vector3;
            var q, r, t, s, n, v, w, u, x, K, A, G, B, C, E, H, y, Q, z, R, L, I, F, P, X, N, la = new THREE.Vector3,
                S = new THREE.Vector3,
                W, D, ha, fa, U, M = this.offsets,
                p = 0;
            for (D = M.length; p < D; ++p) {
                W = M[p].start;
                ha = M[p].count;
                var da = M[p].index,
                    g = W;
                for (W += ha; g < W; g += 3) ha = da + c[g], fa = da + c[g + 1], U = da + c[g + 2], a(ha, fa, U)
            }
            var wa = new THREE.Vector3,
                ia = new THREE.Vector3,
                xa = new THREE.Vector3,
                Ca = new THREE.Vector3,
                Ha, Ea, ba, p = 0;
            for (D = M.length; p < D; ++p)
                for (W = M[p].start, ha = M[p].count, da = M[p].index, g = W, W += ha; g < W; g += 3) ha = da + c[g], fa = da + c[g + 1], U = da + c[g + 2], b(ha), b(fa), b(U)
        }
    },
    computeOffsets: function(a) {
        var b = a;
        void 0 === a && (b = 65535);
        Date.now();
        a = this.attributes.index.array;
        for (var c = this.attributes.position.array, d = a.length / 3, e = new Uint16Array(a.length), f = 0, g = 0, h = [{
                start: 0,
                count: 0,
                index: 0
            }], k = h[0], l = 0, p = 0, q = new Int32Array(6), r = new Int32Array(c.length), t = new Int32Array(c.length), s = 0; s < c.length; s++) r[s] = -1, t[s] = -1;
        for (c =
            0; c < d; c++) {
            for (var n = p = 0; 3 > n; n++) s = a[3 * c + n], -1 == r[s] ? (q[2 * n] = s, q[2 * n + 1] = -1, p++) : r[s] < k.index ? (q[2 * n] = s, q[2 * n + 1] = -1, l++) : (q[2 * n] = s, q[2 * n + 1] = r[s]);
            if (g + p > k.index + b)
                for (k = {
                        start: f,
                        count: 0,
                        index: g
                    }, h.push(k), p = 0; 6 > p; p += 2) n = q[p + 1], -1 < n && n < k.index && (q[p + 1] = -1);
            for (p = 0; 6 > p; p += 2) s = q[p], n = q[p + 1], -1 === n && (n = g++), r[s] = n, t[n] = s, e[f++] = n - k.index, k.count++
        }
        this.reorderBuffers(e, t, g);
        return this.offsets = h
    },
    merge: function() {
        console.log("BufferGeometry.merge(): TODO")
    },
    normalizeNormals: function() {
        for (var a = this.attributes.normal.array,
                b, c, d, e = 0, f = a.length; e < f; e += 3) b = a[e], c = a[e + 1], d = a[e + 2], b = 1 / Math.sqrt(b * b + c * c + d * d), a[e] *= b, a[e + 1] *= b, a[e + 2] *= b
    },
    reorderBuffers: function(a, b, c) {
        var d = {},
            e = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array],
            f;
        for (f in this.attributes)
            if ("index" != f)
                for (var g = this.attributes[f].array, h = 0, k = e.length; h < k; h++) {
                    var l = e[h];
                    if (g instanceof l) {
                        d[f] = new l(this.attributes[f].itemSize * c);
                        break
                    }
                }
            for (e = 0; e < c; e++)
                for (f in g = b[e], this.attributes)
                    if ("index" !=
                        f)
                        for (var h = this.attributes[f].array, k = this.attributes[f].itemSize, l = d[f], p = 0; p < k; p++) l[e * k + p] = h[g * k + p];
        this.attributes.index.array = a;
        for (f in this.attributes) "index" != f && (this.attributes[f].array = d[f], this.attributes[f].numItems = this.attributes[f].itemSize * c)
    },
    clone: function() {
        var a = new THREE.BufferGeometry,
            b = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array],
            c;
        for (c in this.attributes) {
            for (var d = this.attributes[c], e = d.array, f = {
                    itemSize: d.itemSize,
                    array: null
                }, d = 0, g = b.length; d < g; d++) {
                var h = b[d];
                if (e instanceof h) {
                    f.array = new h(e);
                    break
                }
            }
            a.attributes[c] = f
        }
        d = 0;
        for (g = this.offsets.length; d < g; d++) b = this.offsets[d], a.offsets.push({
            start: b.start,
            index: b.index,
            count: b.count
        });
        return a
    },
    dispose: function() {
        this.dispatchEvent({
            type: "dispose"
        })
    }
};
THREE.EventDispatcher.prototype.apply(THREE.BufferGeometry.prototype);
THREE.Geometry = function() {
    this.id = THREE.GeometryIdCount++;
    this.uuid = THREE.Math.generateUUID();
    this.name = "";
    this.vertices = [];
    this.colors = [];
    this.faces = [];
    this.faceVertexUvs = [
        []
    ];
    this.morphTargets = [];
    this.morphColors = [];
    this.morphNormals = [];
    this.skinWeights = [];
    this.skinIndices = [];
    this.lineDistances = [];
    this.boundingSphere = this.boundingBox = null;
    this.hasTangents = !1;
    this.dynamic = !0;
    this.buffersNeedUpdate = this.lineDistancesNeedUpdate = this.colorsNeedUpdate = this.tangentsNeedUpdate = this.normalsNeedUpdate = this.uvsNeedUpdate =
        this.elementsNeedUpdate = this.verticesNeedUpdate = !1
};
THREE.Geometry.prototype = {
    constructor: THREE.Geometry,
    applyMatrix: function(a) {
        for (var b = (new THREE.Matrix3).getNormalMatrix(a), c = 0, d = this.vertices.length; c < d; c++) this.vertices[c].applyMatrix4(a);
        c = 0;
        for (d = this.faces.length; c < d; c++) {
            a = this.faces[c];
            a.normal.applyMatrix3(b).normalize();
            for (var e = 0, f = a.vertexNormals.length; e < f; e++) a.vertexNormals[e].applyMatrix3(b).normalize()
        }
        this.boundingBox instanceof THREE.Box3 && this.computeBoundingBox();
        this.boundingSphere instanceof THREE.Sphere && this.computeBoundingSphere()
    },
    center: function() {
        this.computeBoundingBox();
        var a = new THREE.Vector3;
        a.addVectors(this.boundingBox.min, this.boundingBox.max);
        a.multiplyScalar(-0.5);
        this.applyMatrix((new THREE.Matrix4).makeTranslation(a.x, a.y, a.z));
        this.computeBoundingBox();
        return a
    },
    computeFaceNormals: function() {
        for (var a = new THREE.Vector3, b = new THREE.Vector3, c = 0, d = this.faces.length; c < d; c++) {
            var e = this.faces[c],
                f = this.vertices[e.a],
                g = this.vertices[e.b];
            a.subVectors(this.vertices[e.c], g);
            b.subVectors(f, g);
            a.cross(b);
            a.normalize();
            e.normal.copy(a)
        }
    },
    computeVertexNormals: function(a) {
        var b, c, d;
        d = Array(this.vertices.length);
        b = 0;
        for (c = this.vertices.length; b < c; b++) d[b] = new THREE.Vector3;
        if (a) {
            var e, f, g, h = new THREE.Vector3,
                k = new THREE.Vector3;
            new THREE.Vector3;
            new THREE.Vector3;
            new THREE.Vector3;
            a = 0;
            for (b = this.faces.length; a < b; a++) c = this.faces[a], e = this.vertices[c.a], f = this.vertices[c.b], g = this.vertices[c.c], h.subVectors(g, f), k.subVectors(e, f), h.cross(k), d[c.a].add(h), d[c.b].add(h), d[c.c].add(h)
        } else
            for (a = 0, b = this.faces.length; a <
                b; a++) c = this.faces[a], d[c.a].add(c.normal), d[c.b].add(c.normal), d[c.c].add(c.normal);
        b = 0;
        for (c = this.vertices.length; b < c; b++) d[b].normalize();
        a = 0;
        for (b = this.faces.length; a < b; a++) c = this.faces[a], c.vertexNormals[0] = d[c.a].clone(), c.vertexNormals[1] = d[c.b].clone(), c.vertexNormals[2] = d[c.c].clone()
    },
    computeMorphNormals: function() {
        var a, b, c, d, e;
        c = 0;
        for (d = this.faces.length; c < d; c++)
            for (e = this.faces[c], e.__originalFaceNormal ? e.__originalFaceNormal.copy(e.normal) : e.__originalFaceNormal = e.normal.clone(), e.__originalVertexNormals ||
                (e.__originalVertexNormals = []), a = 0, b = e.vertexNormals.length; a < b; a++) e.__originalVertexNormals[a] ? e.__originalVertexNormals[a].copy(e.vertexNormals[a]) : e.__originalVertexNormals[a] = e.vertexNormals[a].clone();
        var f = new THREE.Geometry;
        f.faces = this.faces;
        a = 0;
        for (b = this.morphTargets.length; a < b; a++) {
            if (!this.morphNormals[a]) {
                this.morphNormals[a] = {};
                this.morphNormals[a].faceNormals = [];
                this.morphNormals[a].vertexNormals = [];
                e = this.morphNormals[a].faceNormals;
                var g = this.morphNormals[a].vertexNormals,
                    h, k;
                c =
                    0;
                for (d = this.faces.length; c < d; c++) h = new THREE.Vector3, k = {
                    a: new THREE.Vector3,
                    b: new THREE.Vector3,
                    c: new THREE.Vector3
                }, e.push(h), g.push(k)
            }
            g = this.morphNormals[a];
            f.vertices = this.morphTargets[a].vertices;
            f.computeFaceNormals();
            f.computeVertexNormals();
            c = 0;
            for (d = this.faces.length; c < d; c++) e = this.faces[c], h = g.faceNormals[c], k = g.vertexNormals[c], h.copy(e.normal), k.a.copy(e.vertexNormals[0]), k.b.copy(e.vertexNormals[1]), k.c.copy(e.vertexNormals[2])
        }
        c = 0;
        for (d = this.faces.length; c < d; c++) e = this.faces[c], e.normal =
            e.__originalFaceNormal, e.vertexNormals = e.__originalVertexNormals
    },
    computeTangents: function() {
        var a, b, c, d, e, f, g, h, k, l, p, q, r, t, s, n, v, w = [],
            u = [];
        c = new THREE.Vector3;
        var x = new THREE.Vector3,
            K = new THREE.Vector3,
            A = new THREE.Vector3,
            G = new THREE.Vector3;
        a = 0;
        for (b = this.vertices.length; a < b; a++) w[a] = new THREE.Vector3, u[a] = new THREE.Vector3;
        a = 0;
        for (b = this.faces.length; a < b; a++) e = this.faces[a], f = this.faceVertexUvs[0][a], d = e.a, v = e.b, e = e.c, g = this.vertices[d], h = this.vertices[v], k = this.vertices[e], l = f[0], p = f[1], q = f[2],
            f = h.x - g.x, r = k.x - g.x, t = h.y - g.y, s = k.y - g.y, h = h.z - g.z, g = k.z - g.z, k = p.x - l.x, n = q.x - l.x, p = p.y - l.y, l = q.y - l.y, q = 1 / (k * l - n * p), c.set((l * f - p * r) * q, (l * t - p * s) * q, (l * h - p * g) * q), x.set((k * r - n * f) * q, (k * s - n * t) * q, (k * g - n * h) * q), w[d].add(c), w[v].add(c), w[e].add(c), u[d].add(x), u[v].add(x), u[e].add(x);
        x = ["a", "b", "c", "d"];
        a = 0;
        for (b = this.faces.length; a < b; a++)
            for (e = this.faces[a], c = 0; c < Math.min(e.vertexNormals.length, 3); c++) G.copy(e.vertexNormals[c]), d = e[x[c]], v = w[d], K.copy(v), K.sub(G.multiplyScalar(G.dot(v))).normalize(), A.crossVectors(e.vertexNormals[c],
                v), d = A.dot(u[d]), d = 0 > d ? -1 : 1, e.vertexTangents[c] = new THREE.Vector4(K.x, K.y, K.z, d);
        this.hasTangents = !0
    },
    computeLineDistances: function() {
        for (var a = 0, b = this.vertices, c = 0, d = b.length; c < d; c++) 0 < c && (a += b[c].distanceTo(b[c - 1])), this.lineDistances[c] = a
    },
    computeBoundingBox: function() {
        null === this.boundingBox && (this.boundingBox = new THREE.Box3);
        this.boundingBox.setFromPoints(this.vertices)
    },
    computeBoundingSphere: function() {
        null === this.boundingSphere && (this.boundingSphere = new THREE.Sphere);
        this.boundingSphere.setFromPoints(this.vertices)
    },
    merge: function(a, b, c) {
        if (!1 === a instanceof THREE.Geometry) console.error("THREE.Geometry.merge(): geometry not an instance of THREE.Geometry.", a);
        else {
            var d, e = this.vertices.length,
                f = this.vertices,
                g = a.vertices,
                h = this.faces,
                k = a.faces,
                l = this.faceVertexUvs[0];
            a = a.faceVertexUvs[0];
            void 0 === c && (c = 0);
            void 0 !== b && (d = (new THREE.Matrix3).getNormalMatrix(b));
            for (var p = 0, q = g.length; p < q; p++) {
                var r = g[p].clone();
                void 0 !== b && r.applyMatrix4(b);
                f.push(r)
            }
            p = 0;
            for (q = k.length; p < q; p++) {
                var g = k[p],
                    t, s = g.vertexNormals,
                    n =
                    g.vertexColors,
                    r = new THREE.Face3(g.a + e, g.b + e, g.c + e);
                r.normal.copy(g.normal);
                void 0 !== d && r.normal.applyMatrix3(d).normalize();
                b = 0;
                for (f = s.length; b < f; b++) t = s[b].clone(), void 0 !== d && t.applyMatrix3(d).normalize(), r.vertexNormals.push(t);
                r.color.copy(g.color);
                b = 0;
                for (f = n.length; b < f; b++) t = n[b], r.vertexColors.push(t.clone());
                r.materialIndex = g.materialIndex + c;
                h.push(r)
            }
            p = 0;
            for (q = a.length; p < q; p++)
                if (c = a[p], d = [], void 0 !== c) {
                    b = 0;
                    for (f = c.length; b < f; b++) d.push(new THREE.Vector2(c[b].x, c[b].y));
                    l.push(d)
                }
        }
    },
    mergeVertices: function() {
        var a = {},
            b = [],
            c = [],
            d, e = Math.pow(10, 4),
            f, g;
        f = 0;
        for (g = this.vertices.length; f < g; f++) d = this.vertices[f], d = Math.round(d.x * e) + "_" + Math.round(d.y * e) + "_" + Math.round(d.z * e), void 0 === a[d] ? (a[d] = f, b.push(this.vertices[f]), c[f] = b.length - 1) : c[f] = c[a[d]];
        a = [];
        f = 0;
        for (g = this.faces.length; f < g; f++)
            for (e = this.faces[f], e.a = c[e.a], e.b = c[e.b], e.c = c[e.c], e = [e.a, e.b, e.c], d = 0; 3 > d; d++)
                if (e[d] == e[(d + 1) % 3]) {
                    a.push(f);
                    break
                }
        for (f = a.length - 1; 0 <= f; f--)
            for (e = a[f], this.faces.splice(e, 1), c = 0, g = this.faceVertexUvs.length; c < g; c++) this.faceVertexUvs[c].splice(e,
                1);
        f = this.vertices.length - b.length;
        this.vertices = b;
        return f
    },
    makeGroups: function() {
        var a = 0;
        return function(b, c) {
            var d, e, f, g, h = {},
                k = this.morphTargets.length,
                l = this.morphNormals.length;
            this.geometryGroups = {};
            d = 0;
            for (e = this.faces.length; d < e; d++) f = this.faces[d], f = b ? f.materialIndex : 0, f in h || (h[f] = {
                    hash: f,
                    counter: 0
                }), g = h[f].hash + "_" + h[f].counter, g in this.geometryGroups || (this.geometryGroups[g] = {
                    faces3: [],
                    materialIndex: f,
                    vertices: 0,
                    numMorphTargets: k,
                    numMorphNormals: l
                }), this.geometryGroups[g].vertices +
                3 > c && (h[f].counter += 1, g = h[f].hash + "_" + h[f].counter, g in this.geometryGroups || (this.geometryGroups[g] = {
                    faces3: [],
                    materialIndex: f,
                    vertices: 0,
                    numMorphTargets: k,
                    numMorphNormals: l
                })), this.geometryGroups[g].faces3.push(d), this.geometryGroups[g].vertices += 3;
            this.geometryGroupsList = [];
            for (var p in this.geometryGroups) this.geometryGroups[p].id = a++, this.geometryGroupsList.push(this.geometryGroups[p])
        }
    }(),
    clone: function() {
        for (var a = new THREE.Geometry, b = this.vertices, c = 0, d = b.length; c < d; c++) a.vertices.push(b[c].clone());
        b = this.faces;
        c = 0;
        for (d = b.length; c < d; c++) a.faces.push(b[c].clone());
        b = this.faceVertexUvs[0];
        c = 0;
        for (d = b.length; c < d; c++) {
            for (var e = b[c], f = [], g = 0, h = e.length; g < h; g++) f.push(new THREE.Vector2(e[g].x, e[g].y));
            a.faceVertexUvs[0].push(f)
        }
        return a
    },
    dispose: function() {
        this.dispatchEvent({
            type: "dispose"
        })
    }
};
THREE.EventDispatcher.prototype.apply(THREE.Geometry.prototype);
THREE.GeometryIdCount = 0;
THREE.Camera = function() {
    THREE.Object3D.call(this);
    this.matrixWorldInverse = new THREE.Matrix4;
    this.projectionMatrix = new THREE.Matrix4
};
THREE.Camera.prototype = Object.create(THREE.Object3D.prototype);
THREE.Camera.prototype.lookAt = function() {
    var a = new THREE.Matrix4;
    return function(b) {
        a.lookAt(this.position, b, this.up);
        this.quaternion.setFromRotationMatrix(a)
    }
}();
THREE.Camera.prototype.clone = function(a) {
    void 0 === a && (a = new THREE.Camera);
    THREE.Object3D.prototype.clone.call(this, a);
    a.matrixWorldInverse.copy(this.matrixWorldInverse);
    a.projectionMatrix.copy(this.projectionMatrix);
    return a
};
THREE.CubeCamera = function(a, b, c) {
    THREE.Object3D.call(this);
    var d = new THREE.PerspectiveCamera(90, 1, a, b);
    d.up.set(0, -1, 0);
    d.lookAt(new THREE.Vector3(1, 0, 0));
    this.add(d);
    var e = new THREE.PerspectiveCamera(90, 1, a, b);
    e.up.set(0, -1, 0);
    e.lookAt(new THREE.Vector3(-1, 0, 0));
    this.add(e);
    var f = new THREE.PerspectiveCamera(90, 1, a, b);
    f.up.set(0, 0, 1);
    f.lookAt(new THREE.Vector3(0, 1, 0));
    this.add(f);
    var g = new THREE.PerspectiveCamera(90, 1, a, b);
    g.up.set(0, 0, -1);
    g.lookAt(new THREE.Vector3(0, -1, 0));
    this.add(g);
    var h = new THREE.PerspectiveCamera(90,
        1, a, b);
    h.up.set(0, -1, 0);
    h.lookAt(new THREE.Vector3(0, 0, 1));
    this.add(h);
    var k = new THREE.PerspectiveCamera(90, 1, a, b);
    k.up.set(0, -1, 0);
    k.lookAt(new THREE.Vector3(0, 0, -1));
    this.add(k);
    this.renderTarget = new THREE.WebGLRenderTargetCube(c, c, {
        format: THREE.RGBFormat,
        magFilter: THREE.LinearFilter,
        minFilter: THREE.LinearFilter
    });
    this.updateCubeMap = function(a, b) {
        var c = this.renderTarget,
            r = c.generateMipmaps;
        c.generateMipmaps = !1;
        c.activeCubeFace = 0;
        a.render(b, d, c);
        c.activeCubeFace = 1;
        a.render(b, e, c);
        c.activeCubeFace =
            2;
        a.render(b, f, c);
        c.activeCubeFace = 3;
        a.render(b, g, c);
        c.activeCubeFace = 4;
        a.render(b, h, c);
        c.generateMipmaps = r;
        c.activeCubeFace = 5;
        a.render(b, k, c)
    }
};
THREE.CubeCamera.prototype = Object.create(THREE.Object3D.prototype);
THREE.OrthographicCamera = function(a, b, c, d, e, f) {
    THREE.Camera.call(this);
    this.left = a;
    this.right = b;
    this.top = c;
    this.bottom = d;
    this.near = void 0 !== e ? e : 0.1;
    this.far = void 0 !== f ? f : 2E3;
    this.updateProjectionMatrix()
};
THREE.OrthographicCamera.prototype = Object.create(THREE.Camera.prototype);
THREE.OrthographicCamera.prototype.updateProjectionMatrix = function() {
    this.projectionMatrix.makeOrthographic(this.left, this.right, this.top, this.bottom, this.near, this.far)
};
THREE.OrthographicCamera.prototype.clone = function() {
    var a = new THREE.OrthographicCamera;
    THREE.Camera.prototype.clone.call(this, a);
    a.left = this.left;
    a.right = this.right;
    a.top = this.top;
    a.bottom = this.bottom;
    a.near = this.near;
    a.far = this.far;
    return a
};
THREE.PerspectiveCamera = function(a, b, c, d) {
    THREE.Camera.call(this);
    this.fov = void 0 !== a ? a : 50;
    this.aspect = void 0 !== b ? b : 1;
    this.near = void 0 !== c ? c : 0.1;
    this.far = void 0 !== d ? d : 2E3;
    this.updateProjectionMatrix()
};
THREE.PerspectiveCamera.prototype = Object.create(THREE.Camera.prototype);
THREE.PerspectiveCamera.prototype.setLens = function(a, b) {
    void 0 === b && (b = 24);
    this.fov = 2 * THREE.Math.radToDeg(Math.atan(b / (2 * a)));
    this.updateProjectionMatrix()
};
THREE.PerspectiveCamera.prototype.setViewOffset = function(a, b, c, d, e, f) {
    this.fullWidth = a;
    this.fullHeight = b;
    this.x = c;
    this.y = d;
    this.width = e;
    this.height = f;
    this.updateProjectionMatrix()
};
THREE.PerspectiveCamera.prototype.updateProjectionMatrix = function() {
    if (this.fullWidth) {
        var a = this.fullWidth / this.fullHeight,
            b = Math.tan(THREE.Math.degToRad(0.5 * this.fov)) * this.near,
            c = -b,
            d = a * c,
            a = Math.abs(a * b - d),
            c = Math.abs(b - c);
        this.projectionMatrix.makeFrustum(d + this.x * a / this.fullWidth, d + (this.x + this.width) * a / this.fullWidth, b - (this.y + this.height) * c / this.fullHeight, b - this.y * c / this.fullHeight, this.near, this.far)
    } else this.projectionMatrix.makePerspective(this.fov, this.aspect, this.near, this.far)
};
THREE.PerspectiveCamera.prototype.clone = function() {
    var a = new THREE.PerspectiveCamera;
    THREE.Camera.prototype.clone.call(this, a);
    a.fov = this.fov;
    a.aspect = this.aspect;
    a.near = this.near;
    a.far = this.far;
    return a
};
THREE.Light = function(a) {
    THREE.Object3D.call(this);
    this.color = new THREE.Color(a)
};
THREE.Light.prototype = Object.create(THREE.Object3D.prototype);
THREE.Light.prototype.clone = function(a) {
    void 0 === a && (a = new THREE.Light);
    THREE.Object3D.prototype.clone.call(this, a);
    a.color.copy(this.color);
    return a
};
THREE.AmbientLight = function(a) {
    THREE.Light.call(this, a)
};
THREE.AmbientLight.prototype = Object.create(THREE.Light.prototype);
THREE.AmbientLight.prototype.clone = function() {
    var a = new THREE.AmbientLight;
    THREE.Light.prototype.clone.call(this, a);
    return a
};
THREE.AreaLight = function(a, b) {
    THREE.Light.call(this, a);
    this.normal = new THREE.Vector3(0, -1, 0);
    this.right = new THREE.Vector3(1, 0, 0);
    this.intensity = void 0 !== b ? b : 1;
    this.height = this.width = 1;
    this.constantAttenuation = 1.5;
    this.linearAttenuation = 0.5;
    this.quadraticAttenuation = 0.1
};
THREE.AreaLight.prototype = Object.create(THREE.Light.prototype);
THREE.DirectionalLight = function(a, b) {
    THREE.Light.call(this, a);
    this.position.set(0, 1, 0);
    this.target = new THREE.Object3D;
    this.intensity = void 0 !== b ? b : 1;
    this.onlyShadow = this.castShadow = !1;
    this.shadowCameraNear = 50;
    this.shadowCameraFar = 5E3;
    this.shadowCameraLeft = -500;
    this.shadowCameraTop = this.shadowCameraRight = 500;
    this.shadowCameraBottom = -500;
    this.shadowCameraVisible = !1;
    this.shadowBias = 0;
    this.shadowDarkness = 0.5;
    this.shadowMapHeight = this.shadowMapWidth = 512;
    this.shadowCascade = !1;
    this.shadowCascadeOffset = new THREE.Vector3(0,
        0, -1E3);
    this.shadowCascadeCount = 2;
    this.shadowCascadeBias = [0, 0, 0];
    this.shadowCascadeWidth = [512, 512, 512];
    this.shadowCascadeHeight = [512, 512, 512];
    this.shadowCascadeNearZ = [-1, 0.99, 0.998];
    this.shadowCascadeFarZ = [0.99, 0.998, 1];
    this.shadowCascadeArray = [];
    this.shadowMatrix = this.shadowCamera = this.shadowMapSize = this.shadowMap = null
};
THREE.DirectionalLight.prototype = Object.create(THREE.Light.prototype);
THREE.DirectionalLight.prototype.clone = function() {
    var a = new THREE.DirectionalLight;
    THREE.Light.prototype.clone.call(this, a);
    a.target = this.target.clone();
    a.intensity = this.intensity;
    a.castShadow = this.castShadow;
    a.onlyShadow = this.onlyShadow;
    a.shadowCameraNear = this.shadowCameraNear;
    a.shadowCameraFar = this.shadowCameraFar;
    a.shadowCameraLeft = this.shadowCameraLeft;
    a.shadowCameraRight = this.shadowCameraRight;
    a.shadowCameraTop = this.shadowCameraTop;
    a.shadowCameraBottom = this.shadowCameraBottom;
    a.shadowCameraVisible =
        this.shadowCameraVisible;
    a.shadowBias = this.shadowBias;
    a.shadowDarkness = this.shadowDarkness;
    a.shadowMapWidth = this.shadowMapWidth;
    a.shadowMapHeight = this.shadowMapHeight;
    a.shadowCascade = this.shadowCascade;
    a.shadowCascadeOffset.copy(this.shadowCascadeOffset);
    a.shadowCascadeCount = this.shadowCascadeCount;
    a.shadowCascadeBias = this.shadowCascadeBias.slice(0);
    a.shadowCascadeWidth = this.shadowCascadeWidth.slice(0);
    a.shadowCascadeHeight = this.shadowCascadeHeight.slice(0);
    a.shadowCascadeNearZ = this.shadowCascadeNearZ.slice(0);
    a.shadowCascadeFarZ = this.shadowCascadeFarZ.slice(0);
    return a
};
THREE.HemisphereLight = function(a, b, c) {
    THREE.Light.call(this, a);
    this.position.set(0, 100, 0);
    this.groundColor = new THREE.Color(b);
    this.intensity = void 0 !== c ? c : 1
};
THREE.HemisphereLight.prototype = Object.create(THREE.Light.prototype);
THREE.HemisphereLight.prototype.clone = function() {
    var a = new THREE.HemisphereLight;
    THREE.Light.prototype.clone.call(this, a);
    a.groundColor.copy(this.groundColor);
    a.intensity = this.intensity;
    return a
};
THREE.PointLight = function(a, b, c) {
    THREE.Light.call(this, a);
    this.intensity = void 0 !== b ? b : 1;
    this.distance = void 0 !== c ? c : 0
};
THREE.PointLight.prototype = Object.create(THREE.Light.prototype);
THREE.PointLight.prototype.clone = function() {
    var a = new THREE.PointLight;
    THREE.Light.prototype.clone.call(this, a);
    a.intensity = this.intensity;
    a.distance = this.distance;
    return a
};
THREE.SpotLight = function(a, b, c, d, e) {
    THREE.Light.call(this, a);
    this.position.set(0, 1, 0);
    this.target = new THREE.Object3D;
    this.intensity = void 0 !== b ? b : 1;
    this.distance = void 0 !== c ? c : 0;
    this.angle = void 0 !== d ? d : Math.PI / 3;
    this.exponent = void 0 !== e ? e : 10;
    this.onlyShadow = this.castShadow = !1;
    this.shadowCameraNear = 50;
    this.shadowCameraFar = 5E3;
    this.shadowCameraFov = 50;
    this.shadowCameraVisible = !1;
    this.shadowBias = 0;
    this.shadowDarkness = 0.5;
    this.shadowMapHeight = this.shadowMapWidth = 512;
    this.shadowMatrix = this.shadowCamera = this.shadowMapSize =
        this.shadowMap = null
};
THREE.SpotLight.prototype = Object.create(THREE.Light.prototype);
THREE.SpotLight.prototype.clone = function() {
    var a = new THREE.SpotLight;
    THREE.Light.prototype.clone.call(this, a);
    a.target = this.target.clone();
    a.intensity = this.intensity;
    a.distance = this.distance;
    a.angle = this.angle;
    a.exponent = this.exponent;
    a.castShadow = this.castShadow;
    a.onlyShadow = this.onlyShadow;
    a.shadowCameraNear = this.shadowCameraNear;
    a.shadowCameraFar = this.shadowCameraFar;
    a.shadowCameraFov = this.shadowCameraFov;
    a.shadowCameraVisible = this.shadowCameraVisible;
    a.shadowBias = this.shadowBias;
    a.shadowDarkness =
        this.shadowDarkness;
    a.shadowMapWidth = this.shadowMapWidth;
    a.shadowMapHeight = this.shadowMapHeight;
    return a
};
THREE.Cache = function() {
    this.files = {}
};
THREE.Cache.prototype = {
    constructor: THREE.Cache,
    add: function(a, b) {
        this.files[a] = b
    },
    get: function(a) {
        return this.files[a]
    },
    remove: function(a) {
        delete this.files[a]
    },
    clear: function() {
        this.files = {}
    }
};
THREE.Loader = function(a) {
    this.statusDomElement = (this.showStatus = a) ? THREE.Loader.prototype.addStatusElement() : null;
    this.imageLoader = new THREE.ImageLoader;
    this.onLoadStart = function() {};
    this.onLoadProgress = function() {};
    this.onLoadComplete = function() {}
};
THREE.Loader.prototype = {
    constructor: THREE.Loader,
    crossOrigin: void 0,
    addStatusElement: function() {
        var a = document.createElement("div");
        a.style.position = "absolute";
        a.style.right = "0px";
        a.style.top = "0px";
        a.style.fontSize = "0.8em";
        a.style.textAlign = "left";
        a.style.background = "rgba(0,0,0,0.25)";
        a.style.color = "#fff";
        a.style.width = "120px";
        a.style.padding = "0.5em 0.5em 0.5em 0.5em";
        a.style.zIndex = 1E3;
        a.innerHTML = "Loading ...";
        return a
    },
    updateProgress: function(a) {
        var b = "Loaded ",
            b = a.total ? b + ((100 * a.loaded / a.total).toFixed(0) +
                "%") : b + ((a.loaded / 1024).toFixed(2) + " KB");
        this.statusDomElement.innerHTML = b
    },
    extractUrlBase: function(a) {
        a = a.split("/");
        if (1 === a.length) return "./";
        a.pop();
        return a.join("/") + "/"
    },
    initMaterials: function(a, b) {
        for (var c = [], d = 0; d < a.length; ++d) c[d] = this.createMaterial(a[d], b);
        return c
    },
    needsTangents: function(a) {
        for (var b = 0, c = a.length; b < c; b++)
            if (a[b] instanceof THREE.ShaderMaterial) return !0;
        return !1
    },
    createMaterial: function(a, b) {
        function c(a) {
            a = Math.log(a) / Math.LN2;
            return Math.pow(2, Math.round(a))
        }

        function d(a,
            d, e, g, h, k, n) {
            var v = b + e,
                w, u = THREE.Loader.Handlers.get(v);
            null !== u ? w = u.load(v) : (w = new THREE.Texture, u = f.imageLoader, u.crossOrigin = f.crossOrigin, u.load(v, function(a) {
                if (!1 === THREE.Math.isPowerOfTwo(a.width) || !1 === THREE.Math.isPowerOfTwo(a.height)) {
                    var b = c(a.width),
                        d = c(a.height),
                        e = document.createElement("canvas");
                    e.width = b;
                    e.height = d;
                    e.getContext("2d").drawImage(a, 0, 0, b, d);
                    w.image = e
                } else w.image = a;
                w.needsUpdate = !0
            }));
            w.sourceFile = e;
            g && (w.repeat.set(g[0], g[1]), 1 !== g[0] && (w.wrapS = THREE.RepeatWrapping),
                1 !== g[1] && (w.wrapT = THREE.RepeatWrapping));
            h && w.offset.set(h[0], h[1]);
            k && (e = {
                repeat: THREE.RepeatWrapping,
                mirror: THREE.MirroredRepeatWrapping
            }, void 0 !== e[k[0]] && (w.wrapS = e[k[0]]), void 0 !== e[k[1]] && (w.wrapT = e[k[1]]));
            n && (w.anisotropy = n);
            a[d] = w
        }

        function e(a) {
            return (255 * a[0] << 16) + (255 * a[1] << 8) + 255 * a[2]
        }
        var f = this,
            g = "MeshLambertMaterial",
            h = {
                color: 15658734,
                opacity: 1,
                map: null,
                lightMap: null,
                normalMap: null,
                bumpMap: null,
                wireframe: !1
            };
        if (a.shading) {
            var k = a.shading.toLowerCase();
            "phong" === k ? g = "MeshPhongMaterial" :
                "basic" === k && (g = "MeshBasicMaterial")
        }
        void 0 !== a.blending && void 0 !== THREE[a.blending] && (h.blending = THREE[a.blending]);
        if (void 0 !== a.transparent || 1 > a.opacity) h.transparent = a.transparent;
        void 0 !== a.depthTest && (h.depthTest = a.depthTest);
        void 0 !== a.depthWrite && (h.depthWrite = a.depthWrite);
        void 0 !== a.visible && (h.visible = a.visible);
        void 0 !== a.flipSided && (h.side = THREE.BackSide);
        void 0 !== a.doubleSided && (h.side = THREE.DoubleSide);
        void 0 !== a.wireframe && (h.wireframe = a.wireframe);
        void 0 !== a.vertexColors && ("face" ===
            a.vertexColors ? h.vertexColors = THREE.FaceColors : a.vertexColors && (h.vertexColors = THREE.VertexColors));
        a.colorDiffuse ? h.color = e(a.colorDiffuse) : a.DbgColor && (h.color = a.DbgColor);
        a.colorSpecular && (h.specular = e(a.colorSpecular));
        a.colorAmbient && (h.ambient = e(a.colorAmbient));
        a.colorEmissive && (h.emissive = e(a.colorEmissive));
        a.transparency && (h.opacity = a.transparency);
        a.specularCoef && (h.shininess = a.specularCoef);
        a.mapDiffuse && b && d(h, "map", a.mapDiffuse, a.mapDiffuseRepeat, a.mapDiffuseOffset, a.mapDiffuseWrap,
            a.mapDiffuseAnisotropy);
        a.mapLight && b && d(h, "lightMap", a.mapLight, a.mapLightRepeat, a.mapLightOffset, a.mapLightWrap, a.mapLightAnisotropy);
        a.mapBump && b && d(h, "bumpMap", a.mapBump, a.mapBumpRepeat, a.mapBumpOffset, a.mapBumpWrap, a.mapBumpAnisotropy);
        a.mapNormal && b && d(h, "normalMap", a.mapNormal, a.mapNormalRepeat, a.mapNormalOffset, a.mapNormalWrap, a.mapNormalAnisotropy);
        a.mapSpecular && b && d(h, "specularMap", a.mapSpecular, a.mapSpecularRepeat, a.mapSpecularOffset, a.mapSpecularWrap, a.mapSpecularAnisotropy);
        a.mapBumpScale &&
            (h.bumpScale = a.mapBumpScale);
        a.mapNormal ? (g = THREE.ShaderLib.normalmap, k = THREE.UniformsUtils.clone(g.uniforms), k.tNormal.value = h.normalMap, a.mapNormalFactor && k.uNormalScale.value.set(a.mapNormalFactor, a.mapNormalFactor), h.map && (k.tDiffuse.value = h.map, k.enableDiffuse.value = !0), h.specularMap && (k.tSpecular.value = h.specularMap, k.enableSpecular.value = !0), h.lightMap && (k.tAO.value = h.lightMap, k.enableAO.value = !0), k.diffuse.value.setHex(h.color), k.specular.value.setHex(h.specular), k.ambient.value.setHex(h.ambient),
            k.shininess.value = h.shininess, void 0 !== h.opacity && (k.opacity.value = h.opacity), g = new THREE.ShaderMaterial({
                fragmentShader: g.fragmentShader,
                vertexShader: g.vertexShader,
                uniforms: k,
                lights: !0,
                fog: !0
            }), h.transparent && (g.transparent = !0)) : g = new THREE[g](h);
        void 0 !== a.DbgName && (g.name = a.DbgName);
        return g
    }
};
THREE.Loader.Handlers = {
    handlers: [],
    add: function(a, b) {
        this.handlers.push(a, b)
    },
    get: function(a) {
        for (var b = 0, c = this.handlers.length; b < c; b += 2) {
            var d = this.handlers[b + 1];
            if (this.handlers[b].test(a)) return d
        }
        return null
    }
};
THREE.XHRLoader = function(a) {
    this.cache = new THREE.Cache;
    this.manager = void 0 !== a ? a : THREE.DefaultLoadingManager
};
THREE.XHRLoader.prototype = {
    constructor: THREE.XHRLoader,
    load: function(a, b, c, d) {
        var e = this,
            f = e.cache.get(a);
        void 0 !== f ? b && b(f) : (f = new XMLHttpRequest, f.open("GET", a, !0), f.addEventListener("load", function(c) {
            e.cache.add(a, this.response);
            b && b(this.response);
            e.manager.itemEnd(a)
        }, !1), void 0 !== c && f.addEventListener("progress", function(a) {
            c(a)
        }, !1), void 0 !== d && f.addEventListener("error", function(a) {
            d(a)
        }, !1), void 0 !== this.crossOrigin && (f.crossOrigin = this.crossOrigin), void 0 !== this.responseType && (f.responseType =
            this.responseType), f.send(null), e.manager.itemStart(a))
    },
    setResponseType: function(a) {
        this.responseType = a
    },
    setCrossOrigin: function(a) {
        this.crossOrigin = a
    }
};
THREE.ImageLoader = function(a) {
    this.cache = new THREE.Cache;
    this.manager = void 0 !== a ? a : THREE.DefaultLoadingManager
};
THREE.ImageLoader.prototype = {
    constructor: THREE.ImageLoader,
    load: function(a, b, c, d) {
        var e = this,
            f = e.cache.get(a);
        if (void 0 !== f) b(f);
        else return f = document.createElement("img"), void 0 !== b && f.addEventListener("load", function(c) {
            e.cache.add(a, this);
            b(this);
            e.manager.itemEnd(a)
        }, !1), void 0 !== c && f.addEventListener("progress", function(a) {
            c(a)
        }, !1), void 0 !== d && f.addEventListener("error", function(a) {
            d(a)
        }, !1), void 0 !== this.crossOrigin && (f.crossOrigin = this.crossOrigin), f.src = a, e.manager.itemStart(a), f
    },
    setCrossOrigin: function(a) {
        this.crossOrigin =
            a
    }
};
THREE.JSONLoader = function(a) {
    THREE.Loader.call(this, a);
    this.withCredentials = !1
};
THREE.JSONLoader.prototype = Object.create(THREE.Loader.prototype);
THREE.JSONLoader.prototype.load = function(a, b, c) {
    c = c && "string" === typeof c ? c : this.extractUrlBase(a);
    this.onLoadStart();
    this.loadAjaxJSON(this, a, b, c)
};
THREE.JSONLoader.prototype.loadAjaxJSON = function(a, b, c, d, e) {
    var f = new XMLHttpRequest,
        g = 0;
    f.onreadystatechange = function() {
        if (f.readyState === f.DONE)
            if (200 === f.status || 0 === f.status) {
                if (f.responseText) {
                    var h = JSON.parse(f.responseText);
                    if (void 0 !== h.metadata && "scene" === h.metadata.type) {
                        console.error('THREE.JSONLoader: "' + b + '" seems to be a Scene. Use THREE.SceneLoader instead.');
                        return
                    }
                    h = a.parse(h, d);
                    c(h.geometry, h.materials)
                } else console.error('THREE.JSONLoader: "' + b + '" seems to be unreachable or the file is empty.');
                a.onLoadComplete()
            } else console.error("THREE.JSONLoader: Couldn't load \"" + b + '" (' + f.status + ")");
        else f.readyState === f.LOADING ? e && (0 === g && (g = f.getResponseHeader("Content-Length")), e({
            total: g,
            loaded: f.responseText.length
        })) : f.readyState === f.HEADERS_RECEIVED && void 0 !== e && (g = f.getResponseHeader("Content-Length"))
    };
    f.open("GET", b, !0);
    f.withCredentials = this.withCredentials;
    f.send(null)
};
THREE.JSONLoader.prototype.parse = function(a, b) {
    var c = new THREE.Geometry,
        d = void 0 !== a.scale ? 1 / a.scale : 1;
    (function(b) {
        var d, g, h, k, l, p, q, r, t, s, n, v, w, u = a.faces;
        p = a.vertices;
        var x = a.normals,
            K = a.colors,
            A = 0;
        if (void 0 !== a.uvs) {
            for (d = 0; d < a.uvs.length; d++) a.uvs[d].length && A++;
            for (d = 0; d < A; d++) c.faceVertexUvs[d] = []
        }
        k = 0;
        for (l = p.length; k < l;) d = new THREE.Vector3, d.x = p[k++] * b, d.y = p[k++] * b, d.z = p[k++] * b, c.vertices.push(d);
        k = 0;
        for (l = u.length; k < l;)
            if (b = u[k++], t = b & 1, h = b & 2, d = b & 8, q = b & 16, s = b & 32, p = b & 64, b &= 128, t) {
                t = new THREE.Face3;
                t.a = u[k];
                t.b = u[k + 1];
                t.c = u[k + 3];
                n = new THREE.Face3;
                n.a = u[k + 1];
                n.b = u[k + 2];
                n.c = u[k + 3];
                k += 4;
                h && (h = u[k++], t.materialIndex = h, n.materialIndex = h);
                h = c.faces.length;
                if (d)
                    for (d = 0; d < A; d++)
                        for (v = a.uvs[d], c.faceVertexUvs[d][h] = [], c.faceVertexUvs[d][h + 1] = [], g = 0; 4 > g; g++) r = u[k++], w = v[2 * r], r = v[2 * r + 1], w = new THREE.Vector2(w, r), 2 !== g && c.faceVertexUvs[d][h].push(w), 0 !== g && c.faceVertexUvs[d][h + 1].push(w);
                q && (q = 3 * u[k++], t.normal.set(x[q++], x[q++], x[q]), n.normal.copy(t.normal));
                if (s)
                    for (d = 0; 4 > d; d++) q = 3 * u[k++], s = new THREE.Vector3(x[q++],
                        x[q++], x[q]), 2 !== d && t.vertexNormals.push(s), 0 !== d && n.vertexNormals.push(s);
                p && (p = u[k++], p = K[p], t.color.setHex(p), n.color.setHex(p));
                if (b)
                    for (d = 0; 4 > d; d++) p = u[k++], p = K[p], 2 !== d && t.vertexColors.push(new THREE.Color(p)), 0 !== d && n.vertexColors.push(new THREE.Color(p));
                c.faces.push(t);
                c.faces.push(n)
            } else {
                t = new THREE.Face3;
                t.a = u[k++];
                t.b = u[k++];
                t.c = u[k++];
                h && (h = u[k++], t.materialIndex = h);
                h = c.faces.length;
                if (d)
                    for (d = 0; d < A; d++)
                        for (v = a.uvs[d], c.faceVertexUvs[d][h] = [], g = 0; 3 > g; g++) r = u[k++], w = v[2 * r], r = v[2 * r + 1],
                            w = new THREE.Vector2(w, r), c.faceVertexUvs[d][h].push(w);
                q && (q = 3 * u[k++], t.normal.set(x[q++], x[q++], x[q]));
                if (s)
                    for (d = 0; 3 > d; d++) q = 3 * u[k++], s = new THREE.Vector3(x[q++], x[q++], x[q]), t.vertexNormals.push(s);
                p && (p = u[k++], t.color.setHex(K[p]));
                if (b)
                    for (d = 0; 3 > d; d++) p = u[k++], t.vertexColors.push(new THREE.Color(K[p]));
                c.faces.push(t)
            }
    })(d);
    (function() {
        var b = void 0 !== a.influencesPerVertex ? a.influencesPerVertex : 2;
        if (a.skinWeights)
            for (var d = 0, g = a.skinWeights.length; d < g; d += b) c.skinWeights.push(new THREE.Vector4(a.skinWeights[d],
                1 < b ? a.skinWeights[d + 1] : 0, 2 < b ? a.skinWeights[d + 2] : 0, 3 < b ? a.skinWeights[d + 3] : 0));
        if (a.skinIndices)
            for (d = 0, g = a.skinIndices.length; d < g; d += b) c.skinIndices.push(new THREE.Vector4(a.skinIndices[d], 1 < b ? a.skinIndices[d + 1] : 0, 2 < b ? a.skinIndices[d + 2] : 0, 3 < b ? a.skinIndices[d + 3] : 0));
        c.bones = a.bones;
        c.bones && 0 < c.bones.length && (c.skinWeights.length !== c.skinIndices.length || c.skinIndices.length !== c.vertices.length) && console.warn("When skinning, number of vertices (" + c.vertices.length + "), skinIndices (" + c.skinIndices.length +
            "), and skinWeights (" + c.skinWeights.length + ") should match.");
        c.animation = a.animation;
        c.animations = a.animations
    })();
    (function(b) {
        if (void 0 !== a.morphTargets) {
            var d, g, h, k, l, p;
            d = 0;
            for (g = a.morphTargets.length; d < g; d++)
                for (c.morphTargets[d] = {}, c.morphTargets[d].name = a.morphTargets[d].name, c.morphTargets[d].vertices = [], l = c.morphTargets[d].vertices, p = a.morphTargets[d].vertices, h = 0, k = p.length; h < k; h += 3) {
                    var q = new THREE.Vector3;
                    q.x = p[h] * b;
                    q.y = p[h + 1] * b;
                    q.z = p[h + 2] * b;
                    l.push(q)
                }
        }
        if (void 0 !== a.morphColors)
            for (d =
                0, g = a.morphColors.length; d < g; d++)
                for (c.morphColors[d] = {}, c.morphColors[d].name = a.morphColors[d].name, c.morphColors[d].colors = [], k = c.morphColors[d].colors, l = a.morphColors[d].colors, b = 0, h = l.length; b < h; b += 3) p = new THREE.Color(16755200), p.setRGB(l[b], l[b + 1], l[b + 2]), k.push(p)
    })(d);
    c.computeFaceNormals();
    c.computeBoundingSphere();
    if (void 0 === a.materials || 0 === a.materials.length) return {
        geometry: c
    };
    d = this.initMaterials(a.materials, b);
    this.needsTangents(d) && c.computeTangents();
    return {
        geometry: c,
        materials: d
    }
};
THREE.LoadingManager = function(a, b, c) {
    var d = this,
        e = 0,
        f = 0;
    this.onLoad = a;
    this.onProgress = b;
    this.onError = c;
    this.itemStart = function(a) {
        f++
    };
    this.itemEnd = function(a) {
        e++;
        if (void 0 !== d.onProgress) d.onProgress(a, e, f);
        if (e === f && void 0 !== d.onLoad) d.onLoad()
    }
};
THREE.DefaultLoadingManager = new THREE.LoadingManager;
THREE.BufferGeometryLoader = function(a) {
    this.manager = void 0 !== a ? a : THREE.DefaultLoadingManager
};
THREE.BufferGeometryLoader.prototype = {
    constructor: THREE.BufferGeometryLoader,
    load: function(a, b, c, d) {
        var e = this,
            f = new THREE.XHRLoader;
        f.setCrossOrigin(this.crossOrigin);
        f.load(a, function(a) {
            b(e.parse(JSON.parse(a)))
        }, c, d)
    },
    setCrossOrigin: function(a) {
        this.crossOrigin = a
    },
    parse: function(a) {
        var b = new THREE.BufferGeometry,
            c = a.attributes,
            d;
        for (d in c) {
            var e = c[d];
            b.attributes[d] = {
                itemSize: e.itemSize,
                array: new self[e.type](e.array)
            }
        }
        c = a.offsets;
        void 0 !== c && (b.offsets = JSON.parse(JSON.stringify(c)));
        a = a.boundingSphere;
        void 0 !== a && (b.boundingSphere = new THREE.Sphere((new THREE.Vector3).fromArray(void 0 !== a.center ? a.center : [0, 0, 0]), a.radius));
        return b
    }
};
THREE.MaterialLoader = function(a) {
    this.manager = void 0 !== a ? a : THREE.DefaultLoadingManager
};
THREE.MaterialLoader.prototype = {
    constructor: THREE.MaterialLoader,
    load: function(a, b, c, d) {
        var e = this,
            f = new THREE.XHRLoader;
        f.setCrossOrigin(this.crossOrigin);
        f.load(a, function(a) {
            b(e.parse(JSON.parse(a)))
        }, c, d)
    },
    setCrossOrigin: function(a) {
        this.crossOrigin = a
    },
    parse: function(a) {
        var b = new THREE[a.type];
        void 0 !== a.color && b.color.setHex(a.color);
        void 0 !== a.ambient && b.ambient.setHex(a.ambient);
        void 0 !== a.emissive && b.emissive.setHex(a.emissive);
        void 0 !== a.specular && b.specular.setHex(a.specular);
        void 0 !== a.shininess &&
            (b.shininess = a.shininess);
        void 0 !== a.vertexColors && (b.vertexColors = a.vertexColors);
        void 0 !== a.blending && (b.blending = a.blending);
        void 0 !== a.side && (b.side = a.side);
        void 0 !== a.opacity && (b.opacity = a.opacity);
        void 0 !== a.transparent && (b.transparent = a.transparent);
        void 0 !== a.wireframe && (b.wireframe = a.wireframe);
        if (void 0 !== a.materials)
            for (var c = 0, d = a.materials.length; c < d; c++) b.materials.push(this.parse(a.materials[c]));
        return b
    }
};
THREE.ObjectLoader = function(a) {
    this.manager = void 0 !== a ? a : THREE.DefaultLoadingManager
};
THREE.ObjectLoader.prototype = {
    constructor: THREE.ObjectLoader,
    load: function(a, b, c, d) {
        var e = this,
            f = new THREE.XHRLoader(e.manager);
        f.setCrossOrigin(this.crossOrigin);
        f.load(a, function(a) {
            b(e.parse(JSON.parse(a)))
        }, c, d)
    },
    setCrossOrigin: function(a) {
        this.crossOrigin = a
    },
    parse: function(a) {
        var b = this.parseGeometries(a.geometries),
            c = this.parseMaterials(a.materials);
        return this.parseObject(a.object, b, c)
    },
    parseGeometries: function(a) {
        var b = {};
        if (void 0 !== a)
            for (var c = new THREE.JSONLoader, d = new THREE.BufferGeometryLoader,
                    e = 0, f = a.length; e < f; e++) {
                var g, h = a[e];
                switch (h.type) {
                    case "PlaneGeometry":
                        g = new THREE.PlaneGeometry(h.width, h.height, h.widthSegments, h.heightSegments);
                        break;
                    case "BoxGeometry":
                    case "CubeGeometry":
                        g = new THREE.BoxGeometry(h.width, h.height, h.depth, h.widthSegments, h.heightSegments, h.depthSegments);
                        break;
                    case "CircleGeometry":
                        g = new THREE.CircleGeometry(h.radius, h.segments);
                        break;
                    case "CylinderGeometry":
                        g = new THREE.CylinderGeometry(h.radiusTop, h.radiusBottom, h.height, h.radialSegments, h.heightSegments, h.openEnded);
                        break;
                    case "SphereGeometry":
                        g = new THREE.SphereGeometry(h.radius, h.widthSegments, h.heightSegments, h.phiStart, h.phiLength, h.thetaStart, h.thetaLength);
                        break;
                    case "IcosahedronGeometry":
                        g = new THREE.IcosahedronGeometry(h.radius, h.detail);
                        break;
                    case "TorusGeometry":
                        g = new THREE.TorusGeometry(h.radius, h.tube, h.radialSegments, h.tubularSegments, h.arc);
                        break;
                    case "TorusKnotGeometry":
                        g = new THREE.TorusKnotGeometry(h.radius, h.tube, h.radialSegments, h.tubularSegments, h.p, h.q, h.heightScale);
                        break;
                    case "BufferGeometry":
                        g =
                            d.parse(h.data);
                        break;
                    case "Geometry":
                        g = c.parse(h.data).geometry
                }
                g.uuid = h.uuid;
                void 0 !== h.name && (g.name = h.name);
                b[h.uuid] = g
            }
        return b
    },
    parseMaterials: function(a) {
        var b = {};
        if (void 0 !== a)
            for (var c = new THREE.MaterialLoader, d = 0, e = a.length; d < e; d++) {
                var f = a[d],
                    g = c.parse(f);
                g.uuid = f.uuid;
                void 0 !== f.name && (g.name = f.name);
                b[f.uuid] = g
            }
        return b
    },
    parseObject: function() {
        var a = new THREE.Matrix4;
        return function(b, c, d) {
            var e;
            switch (b.type) {
                case "Scene":
                    e = new THREE.Scene;
                    break;
                case "PerspectiveCamera":
                    e = new THREE.PerspectiveCamera(b.fov,
                        b.aspect, b.near, b.far);
                    break;
                case "OrthographicCamera":
                    e = new THREE.OrthographicCamera(b.left, b.right, b.top, b.bottom, b.near, b.far);
                    break;
                case "AmbientLight":
                    e = new THREE.AmbientLight(b.color);
                    break;
                case "DirectionalLight":
                    e = new THREE.DirectionalLight(b.color, b.intensity);
                    break;
                case "PointLight":
                    e = new THREE.PointLight(b.color, b.intensity, b.distance);
                    break;
                case "SpotLight":
                    e = new THREE.SpotLight(b.color, b.intensity, b.distance, b.angle, b.exponent);
                    break;
                case "HemisphereLight":
                    e = new THREE.HemisphereLight(b.color,
                        b.groundColor, b.intensity);
                    break;
                case "Mesh":
                    e = c[b.geometry];
                    var f = d[b.material];
                    void 0 === e && console.error("THREE.ObjectLoader: Undefined geometry " + b.geometry);
                    void 0 === f && console.error("THREE.ObjectLoader: Undefined material " + b.material);
                    e = new THREE.Mesh(e, f);
                    break;
                case "Sprite":
                    f = d[b.material];
                    void 0 === f && console.error("THREE.ObjectLoader: Undefined material " + b.material);
                    e = new THREE.Sprite(f);
                    break;
                default:
                    e = new THREE.Object3D
            }
            e.uuid = b.uuid;
            void 0 !== b.name && (e.name = b.name);
            void 0 !== b.matrix ?
                (a.fromArray(b.matrix), a.decompose(e.position, e.quaternion, e.scale)) : (void 0 !== b.position && e.position.fromArray(b.position), void 0 !== b.rotation && e.rotation.fromArray(b.rotation), void 0 !== b.scale && e.scale.fromArray(b.scale));
            void 0 !== b.visible && (e.visible = b.visible);
            void 0 !== b.userData && (e.userData = b.userData);
            if (void 0 !== b.children)
                for (var g in b.children) e.add(this.parseObject(b.children[g], c, d));
            return e
        }
    }()
};
THREE.TextureLoader = function(a) {
    this.manager = void 0 !== a ? a : THREE.DefaultLoadingManager
};
THREE.TextureLoader.prototype = {
    constructor: THREE.TextureLoader,
    load: function(a, b, c, d) {
        var e = new THREE.ImageLoader(this.manager);
        e.setCrossOrigin(this.crossOrigin);
        e.load(a, function(a) {
            a = new THREE.Texture(a);
            a.needsUpdate = !0;
            void 0 !== b && b(a)
        }, c, d)
    },
    setCrossOrigin: function(a) {
        this.crossOrigin = a
    }
};
THREE.Material = function() {
    this.id = THREE.MaterialIdCount++;
    this.uuid = THREE.Math.generateUUID();
    this.name = "";
    this.side = THREE.FrontSide;
    this.opacity = 1;
    this.transparent = !1;
    this.blending = THREE.NormalBlending;
    this.blendSrc = THREE.SrcAlphaFactor;
    this.blendDst = THREE.OneMinusSrcAlphaFactor;
    this.blendEquation = THREE.AddEquation;
    this.depthWrite = this.depthTest = !0;
    this.polygonOffset = !1;
    this.overdraw = this.alphaTest = this.polygonOffsetUnits = this.polygonOffsetFactor = 0;
    this.needsUpdate = this.visible = !0
};
THREE.Material.prototype = {
    constructor: THREE.Material,
    setValues: function(a) {
        if (void 0 !== a)
            for (var b in a) {
                var c = a[b];
                if (void 0 === c) console.warn("THREE.Material: '" + b + "' parameter is undefined.");
                else if (b in this) {
                    var d = this[b];
                    d instanceof THREE.Color ? d.set(c) : d instanceof THREE.Vector3 && c instanceof THREE.Vector3 ? d.copy(c) : this[b] = "overdraw" == b ? Number(c) : c
                }
            }
    },
    clone: function(a) {
        void 0 === a && (a = new THREE.Material);
        a.name = this.name;
        a.side = this.side;
        a.opacity = this.opacity;
        a.transparent = this.transparent;
        a.blending = this.blending;
        a.blendSrc = this.blendSrc;
        a.blendDst = this.blendDst;
        a.blendEquation = this.blendEquation;
        a.depthTest = this.depthTest;
        a.depthWrite = this.depthWrite;
        a.polygonOffset = this.polygonOffset;
        a.polygonOffsetFactor = this.polygonOffsetFactor;
        a.polygonOffsetUnits = this.polygonOffsetUnits;
        a.alphaTest = this.alphaTest;
        a.overdraw = this.overdraw;
        a.visible = this.visible;
        return a
    },
    dispose: function() {
        this.dispatchEvent({
            type: "dispose"
        })
    }
};
THREE.EventDispatcher.prototype.apply(THREE.Material.prototype);
THREE.MaterialIdCount = 0;
THREE.LineBasicMaterial = function(a) {
    THREE.Material.call(this);
    this.color = new THREE.Color(16777215);
    this.linewidth = 1;
    this.linejoin = this.linecap = "round";
    this.vertexColors = THREE.NoColors;
    this.fog = !0;
    this.setValues(a)
};
THREE.LineBasicMaterial.prototype = Object.create(THREE.Material.prototype);
THREE.LineBasicMaterial.prototype.clone = function() {
    var a = new THREE.LineBasicMaterial;
    THREE.Material.prototype.clone.call(this, a);
    a.color.copy(this.color);
    a.linewidth = this.linewidth;
    a.linecap = this.linecap;
    a.linejoin = this.linejoin;
    a.vertexColors = this.vertexColors;
    a.fog = this.fog;
    return a
};
THREE.LineDashedMaterial = function(a) {
    THREE.Material.call(this);
    this.color = new THREE.Color(16777215);
    this.scale = this.linewidth = 1;
    this.dashSize = 3;
    this.gapSize = 1;
    this.vertexColors = !1;
    this.fog = !0;
    this.setValues(a)
};
THREE.LineDashedMaterial.prototype = Object.create(THREE.Material.prototype);
THREE.LineDashedMaterial.prototype.clone = function() {
    var a = new THREE.LineDashedMaterial;
    THREE.Material.prototype.clone.call(this, a);
    a.color.copy(this.color);
    a.linewidth = this.linewidth;
    a.scale = this.scale;
    a.dashSize = this.dashSize;
    a.gapSize = this.gapSize;
    a.vertexColors = this.vertexColors;
    a.fog = this.fog;
    return a
};
THREE.MeshBasicMaterial = function(a) {
    THREE.Material.call(this);
    this.color = new THREE.Color(16777215);
    this.envMap = this.specularMap = this.lightMap = this.map = null;
    this.combine = THREE.MultiplyOperation;
    this.reflectivity = 1;
    this.refractionRatio = 0.98;
    this.fog = !0;
    this.shading = THREE.SmoothShading;
    this.wireframe = !1;
    this.wireframeLinewidth = 1;
    this.wireframeLinejoin = this.wireframeLinecap = "round";
    this.vertexColors = THREE.NoColors;
    this.morphTargets = this.skinning = !1;
    this.setValues(a)
};
THREE.MeshBasicMaterial.prototype = Object.create(THREE.Material.prototype);
THREE.MeshBasicMaterial.prototype.clone = function() {
    var a = new THREE.MeshBasicMaterial;
    THREE.Material.prototype.clone.call(this, a);
    a.color.copy(this.color);
    a.map = this.map;
    a.lightMap = this.lightMap;
    a.specularMap = this.specularMap;
    a.envMap = this.envMap;
    a.combine = this.combine;
    a.reflectivity = this.reflectivity;
    a.refractionRatio = this.refractionRatio;
    a.fog = this.fog;
    a.shading = this.shading;
    a.wireframe = this.wireframe;
    a.wireframeLinewidth = this.wireframeLinewidth;
    a.wireframeLinecap = this.wireframeLinecap;
    a.wireframeLinejoin =
        this.wireframeLinejoin;
    a.vertexColors = this.vertexColors;
    a.skinning = this.skinning;
    a.morphTargets = this.morphTargets;
    return a
};
THREE.MeshLambertMaterial = function(a) {
    THREE.Material.call(this);
    this.color = new THREE.Color(16777215);
    this.ambient = new THREE.Color(16777215);
    this.emissive = new THREE.Color(0);
    this.wrapAround = !1;
    this.wrapRGB = new THREE.Vector3(1, 1, 1);
    this.envMap = this.specularMap = this.lightMap = this.map = null;
    this.combine = THREE.MultiplyOperation;
    this.reflectivity = 1;
    this.refractionRatio = 0.98;
    this.fog = !0;
    this.shading = THREE.SmoothShading;
    this.wireframe = !1;
    this.wireframeLinewidth = 1;
    this.wireframeLinejoin = this.wireframeLinecap =
        "round";
    this.vertexColors = THREE.NoColors;
    this.morphNormals = this.morphTargets = this.skinning = !1;
    this.setValues(a)
};
THREE.MeshLambertMaterial.prototype = Object.create(THREE.Material.prototype);
THREE.MeshLambertMaterial.prototype.clone = function() {
    var a = new THREE.MeshLambertMaterial;
    THREE.Material.prototype.clone.call(this, a);
    a.color.copy(this.color);
    a.ambient.copy(this.ambient);
    a.emissive.copy(this.emissive);
    a.wrapAround = this.wrapAround;
    a.wrapRGB.copy(this.wrapRGB);
    a.map = this.map;
    a.lightMap = this.lightMap;
    a.specularMap = this.specularMap;
    a.envMap = this.envMap;
    a.combine = this.combine;
    a.reflectivity = this.reflectivity;
    a.refractionRatio = this.refractionRatio;
    a.fog = this.fog;
    a.shading = this.shading;
    a.wireframe = this.wireframe;
    a.wireframeLinewidth = this.wireframeLinewidth;
    a.wireframeLinecap = this.wireframeLinecap;
    a.wireframeLinejoin = this.wireframeLinejoin;
    a.vertexColors = this.vertexColors;
    a.skinning = this.skinning;
    a.morphTargets = this.morphTargets;
    a.morphNormals = this.morphNormals;
    return a
};
THREE.MeshPhongMaterial = function(a) {
    THREE.Material.call(this);
    this.color = new THREE.Color(16777215);
    this.ambient = new THREE.Color(16777215);
    this.emissive = new THREE.Color(0);
    this.specular = new THREE.Color(1118481);
    this.shininess = 30;
    this.wrapAround = this.metal = !1;
    this.wrapRGB = new THREE.Vector3(1, 1, 1);
    this.bumpMap = this.lightMap = this.map = null;
    this.bumpScale = 1;
    this.normalMap = null;
    this.normalScale = new THREE.Vector2(1, 1);
    this.envMap = this.specularMap = null;
    this.combine = THREE.MultiplyOperation;
    this.reflectivity =
        1;
    this.refractionRatio = 0.98;
    this.fog = !0;
    this.shading = THREE.SmoothShading;
    this.wireframe = !1;
    this.wireframeLinewidth = 1;
    this.wireframeLinejoin = this.wireframeLinecap = "round";
    this.vertexColors = THREE.NoColors;
    this.morphNormals = this.morphTargets = this.skinning = !1;
    this.setValues(a)
};
THREE.MeshPhongMaterial.prototype = Object.create(THREE.Material.prototype);
THREE.MeshPhongMaterial.prototype.clone = function() {
    var a = new THREE.MeshPhongMaterial;
    THREE.Material.prototype.clone.call(this, a);
    a.color.copy(this.color);
    a.ambient.copy(this.ambient);
    a.emissive.copy(this.emissive);
    a.specular.copy(this.specular);
    a.shininess = this.shininess;
    a.metal = this.metal;
    a.wrapAround = this.wrapAround;
    a.wrapRGB.copy(this.wrapRGB);
    a.map = this.map;
    a.lightMap = this.lightMap;
    a.bumpMap = this.bumpMap;
    a.bumpScale = this.bumpScale;
    a.normalMap = this.normalMap;
    a.normalScale.copy(this.normalScale);
    a.specularMap = this.specularMap;
    a.envMap = this.envMap;
    a.combine = this.combine;
    a.reflectivity = this.reflectivity;
    a.refractionRatio = this.refractionRatio;
    a.fog = this.fog;
    a.shading = this.shading;
    a.wireframe = this.wireframe;
    a.wireframeLinewidth = this.wireframeLinewidth;
    a.wireframeLinecap = this.wireframeLinecap;
    a.wireframeLinejoin = this.wireframeLinejoin;
    a.vertexColors = this.vertexColors;
    a.skinning = this.skinning;
    a.morphTargets = this.morphTargets;
    a.morphNormals = this.morphNormals;
    return a
};
THREE.MeshDepthMaterial = function(a) {
    THREE.Material.call(this);
    this.wireframe = this.morphTargets = !1;
    this.wireframeLinewidth = 1;
    this.setValues(a)
};
THREE.MeshDepthMaterial.prototype = Object.create(THREE.Material.prototype);
THREE.MeshDepthMaterial.prototype.clone = function() {
    var a = new THREE.MeshDepthMaterial;
    THREE.Material.prototype.clone.call(this, a);
    a.wireframe = this.wireframe;
    a.wireframeLinewidth = this.wireframeLinewidth;
    return a
};
THREE.MeshNormalMaterial = function(a) {
    THREE.Material.call(this, a);
    this.shading = THREE.FlatShading;
    this.wireframe = !1;
    this.wireframeLinewidth = 1;
    this.morphTargets = !1;
    this.setValues(a)
};
THREE.MeshNormalMaterial.prototype = Object.create(THREE.Material.prototype);
THREE.MeshNormalMaterial.prototype.clone = function() {
    var a = new THREE.MeshNormalMaterial;
    THREE.Material.prototype.clone.call(this, a);
    a.shading = this.shading;
    a.wireframe = this.wireframe;
    a.wireframeLinewidth = this.wireframeLinewidth;
    return a
};
THREE.MeshFaceMaterial = function(a) {
    this.materials = a instanceof Array ? a : []
};
THREE.MeshFaceMaterial.prototype.clone = function() {
    for (var a = new THREE.MeshFaceMaterial, b = 0; b < this.materials.length; b++) a.materials.push(this.materials[b].clone());
    return a
};
THREE.PointCloudMaterial = function(a) {
    THREE.Material.call(this);
    this.color = new THREE.Color(16777215);
    this.map = null;
    this.size = 1;
    this.sizeAttenuation = !0;
    this.vertexColors = THREE.NoColors;
    this.fog = !0;
    this.setValues(a)
};
THREE.PointCloudMaterial.prototype = Object.create(THREE.Material.prototype);
THREE.PointCloudMaterial.prototype.clone = function() {
    var a = new THREE.PointCloudMaterial;
    THREE.Material.prototype.clone.call(this, a);
    a.color.copy(this.color);
    a.map = this.map;
    a.size = this.size;
    a.sizeAttenuation = this.sizeAttenuation;
    a.vertexColors = this.vertexColors;
    a.fog = this.fog;
    return a
};
THREE.ParticleSystemMaterial = function(a) {
    console.warn("THREE.ParticleSystemMaterial has been renamed to THREE.PointCloudMaterial.");
    return new THREE.PointCloudMaterial(a)
};
THREE.ShaderMaterial = function(a) {
    THREE.Material.call(this);
    this.vertexShader = this.fragmentShader = "void main() {}";
    this.uniforms = {};
    this.defines = {};
    this.attributes = null;
    this.shading = THREE.SmoothShading;
    this.linewidth = 1;
    this.wireframe = !1;
    this.wireframeLinewidth = 1;
    this.lights = this.fog = !1;
    this.vertexColors = THREE.NoColors;
    this.morphNormals = this.morphTargets = this.skinning = !1;
    this.defaultAttributeValues = {
        color: [1, 1, 1],
        uv: [0, 0],
        uv2: [0, 0]
    };
    this.index0AttributeName = void 0;
    this.setValues(a)
};
THREE.ShaderMaterial.prototype = Object.create(THREE.Material.prototype);
THREE.ShaderMaterial.prototype.clone = function() {
    var a = new THREE.ShaderMaterial;
    THREE.Material.prototype.clone.call(this, a);
    a.fragmentShader = this.fragmentShader;
    a.vertexShader = this.vertexShader;
    a.uniforms = THREE.UniformsUtils.clone(this.uniforms);
    a.attributes = this.attributes;
    a.defines = this.defines;
    a.shading = this.shading;
    a.wireframe = this.wireframe;
    a.wireframeLinewidth = this.wireframeLinewidth;
    a.fog = this.fog;
    a.lights = this.lights;
    a.vertexColors = this.vertexColors;
    a.skinning = this.skinning;
    a.morphTargets =
        this.morphTargets;
    a.morphNormals = this.morphNormals;
    return a
};
THREE.RawShaderMaterial = function(a) {
    THREE.ShaderMaterial.call(this, a)
};
THREE.RawShaderMaterial.prototype = Object.create(THREE.ShaderMaterial.prototype);
THREE.RawShaderMaterial.prototype.clone = function() {
    var a = new THREE.RawShaderMaterial;
    THREE.ShaderMaterial.prototype.clone.call(this, a);
    return a
};
THREE.SpriteMaterial = function(a) {
    THREE.Material.call(this);
    this.color = new THREE.Color(16777215);
    this.map = null;
    this.rotation = 0;
    this.fog = !1;
    this.setValues(a)
};
THREE.SpriteMaterial.prototype = Object.create(THREE.Material.prototype);
THREE.SpriteMaterial.prototype.clone = function() {
    var a = new THREE.SpriteMaterial;
    THREE.Material.prototype.clone.call(this, a);
    a.color.copy(this.color);
    a.map = this.map;
    a.rotation = this.rotation;
    a.fog = this.fog;
    return a
};
THREE.SpriteCanvasMaterial = function(a) {
    THREE.Material.call(this);
    this.color = new THREE.Color(16777215);
    this.program = function(a, c) {};
    this.setValues(a)
};
THREE.SpriteCanvasMaterial.prototype = Object.create(THREE.Material.prototype);
THREE.SpriteCanvasMaterial.prototype.clone = function() {
    var a = new THREE.SpriteCanvasMaterial;
    THREE.Material.prototype.clone.call(this, a);
    a.color.copy(this.color);
    a.program = this.program;
    return a
};
THREE.ParticleCanvasMaterial = THREE.SpriteCanvasMaterial;
THREE.Texture = function(a, b, c, d, e, f, g, h, k) {
    this.id = THREE.TextureIdCount++;
    this.uuid = THREE.Math.generateUUID();
    this.name = "";
    this.image = void 0 !== a ? a : THREE.Texture.DEFAULT_IMAGE;
    this.mipmaps = [];
    this.mapping = void 0 !== b ? b : THREE.Texture.DEFAULT_MAPPING;
    this.wrapS = void 0 !== c ? c : THREE.ClampToEdgeWrapping;
    this.wrapT = void 0 !== d ? d : THREE.ClampToEdgeWrapping;
    this.magFilter = void 0 !== e ? e : THREE.LinearFilter;
    this.minFilter = void 0 !== f ? f : THREE.LinearMipMapLinearFilter;
    this.anisotropy = void 0 !== k ? k : 1;
    this.format = void 0 !==
        g ? g : THREE.RGBAFormat;
    this.type = void 0 !== h ? h : THREE.UnsignedByteType;
    this.offset = new THREE.Vector2(0, 0);
    this.repeat = new THREE.Vector2(1, 1);
    this.generateMipmaps = !0;
    this.premultiplyAlpha = !1;
    this.flipY = !0;
    this.unpackAlignment = 4;
    this._needsUpdate = !1;
    this.onUpdate = null
};
THREE.Texture.DEFAULT_IMAGE = void 0;
THREE.Texture.DEFAULT_MAPPING = new THREE.UVMapping;
THREE.Texture.prototype = {
    constructor: THREE.Texture,
    get needsUpdate() {
        return this._needsUpdate
    },
    set needsUpdate(a) {
        !0 === a && this.update();
        this._needsUpdate = a
    },
    clone: function(a) {
        void 0 === a && (a = new THREE.Texture);
        a.image = this.image;
        a.mipmaps = this.mipmaps.slice(0);
        a.mapping = this.mapping;
        a.wrapS = this.wrapS;
        a.wrapT = this.wrapT;
        a.magFilter = this.magFilter;
        a.minFilter = this.minFilter;
        a.anisotropy = this.anisotropy;
        a.format = this.format;
        a.type = this.type;
        a.offset.copy(this.offset);
        a.repeat.copy(this.repeat);
        a.generateMipmaps =
            this.generateMipmaps;
        a.premultiplyAlpha = this.premultiplyAlpha;
        a.flipY = this.flipY;
        a.unpackAlignment = this.unpackAlignment;
        return a
    },
    update: function() {
        this.dispatchEvent({
            type: "update"
        })
    },
    dispose: function() {
        this.dispatchEvent({
            type: "dispose"
        })
    }
};
THREE.EventDispatcher.prototype.apply(THREE.Texture.prototype);
THREE.TextureIdCount = 0;
THREE.CubeTexture = function(a, b, c, d, e, f, g, h, k) {
    THREE.Texture.call(this, a, b, c, d, e, f, g, h, k);
    this.images = a
};
THREE.CubeTexture.prototype = Object.create(THREE.Texture.prototype);
THREE.CubeTexture.clone = function(a) {
    void 0 === a && (a = new THREE.CubeTexture);
    THREE.Texture.prototype.clone.call(this, a);
    a.images = this.images;
    return a
};
THREE.CompressedTexture = function(a, b, c, d, e, f, g, h, k, l, p) {
    THREE.Texture.call(this, null, f, g, h, k, l, d, e, p);
    this.image = {
        width: b,
        height: c
    };
    this.mipmaps = a;
    this.generateMipmaps = !1
};
THREE.CompressedTexture.prototype = Object.create(THREE.Texture.prototype);
THREE.CompressedTexture.prototype.clone = function() {
    var a = new THREE.CompressedTexture;
    THREE.Texture.prototype.clone.call(this, a);
    return a
};
THREE.DataTexture = function(a, b, c, d, e, f, g, h, k, l, p) {
    THREE.Texture.call(this, null, f, g, h, k, l, d, e, p);
    this.image = {
        data: a,
        width: b,
        height: c
    }
};
THREE.DataTexture.prototype = Object.create(THREE.Texture.prototype);
THREE.DataTexture.prototype.clone = function() {
    var a = new THREE.DataTexture;
    THREE.Texture.prototype.clone.call(this, a);
    return a
};
THREE.PointCloud = function(a, b) {
    THREE.Object3D.call(this);
    this.geometry = void 0 !== a ? a : new THREE.Geometry;
    this.material = void 0 !== b ? b : new THREE.PointCloudMaterial({
        color: 16777215 * Math.random()
    });
    this.sortParticles = !1
};
THREE.PointCloud.prototype = Object.create(THREE.Object3D.prototype);
THREE.PointCloud.prototype.raycast = function() {
    var a = new THREE.Matrix4,
        b = new THREE.Ray;
    return function(c, d) {
        var e = this,
            f = e.geometry,
            g = c.params.PointCloud.threshold;
        a.getInverse(this.matrixWorld);
        b.copy(c.ray).applyMatrix4(a);
        if (null === f.boundingBox || !1 !== b.isIntersectionBox(f.boundingBox)) {
            var h = g / ((this.scale.x + this.scale.y + this.scale.z) / 3),
                k = new THREE.Vector3,
                g = function(a, f) {
                    var g = b.distanceToPoint(a);
                    if (g < h) {
                        var k = b.closestPointToPoint(a);
                        k.applyMatrix4(e.matrixWorld);
                        var l = c.ray.origin.distanceTo(k);
                        d.push({
                            distance: l,
                            distanceToRay: g,
                            point: k.clone(),
                            index: f,
                            face: null,
                            object: e
                        })
                    }
                };
            if (f instanceof THREE.BufferGeometry) {
                var l = f.attributes,
                    p = l.position.array;
                if (void 0 !== l.index) {
                    var l = l.index.array,
                        q = f.offsets;
                    0 === q.length && (q = [{
                        start: 0,
                        count: l.length,
                        index: 0
                    }]);
                    for (var r = 0, t = q.length; r < t; ++r)
                        for (var s = q[r].start, n = q[r].index, f = s, s = s + q[r].count; f < s; f++) {
                            var v = n + l[f];
                            k.set(p[3 * v], p[3 * v + 1], p[3 * v + 2]);
                            g(k, v)
                        }
                } else
                    for (l = p.length / 3, f = 0; f < l; f++) k.set(p[3 * f], p[3 * f + 1], p[3 * f + 2]), g(k, f)
            } else
                for (k = this.geometry.vertices,
                    f = 0; f < k.length; f++) g(k[f], f)
        }
    }
}();
THREE.PointCloud.prototype.clone = function(a) {
    void 0 === a && (a = new THREE.PointCloud(this.geometry, this.material));
    a.sortParticles = this.sortParticles;
    THREE.Object3D.prototype.clone.call(this, a);
    return a
};
THREE.ParticleSystem = function(a, b) {
    console.warn("THREE.ParticleSystem has been renamed to THREE.PointCloud.");
    return new THREE.PointCloud(a, b)
};
THREE.Line = function(a, b, c) {
    THREE.Object3D.call(this);
    this.geometry = void 0 !== a ? a : new THREE.Geometry;
    this.material = void 0 !== b ? b : new THREE.LineBasicMaterial({
        color: 16777215 * Math.random()
    });
    this.type = void 0 !== c ? c : THREE.LineStrip
};
THREE.LineStrip = 0;
THREE.LinePieces = 1;
THREE.Line.prototype = Object.create(THREE.Object3D.prototype);
THREE.Line.prototype.raycast = function() {
    var a = new THREE.Matrix4,
        b = new THREE.Ray,
        c = new THREE.Sphere;
    return function(d, e) {
        var f = d.linePrecision,
            f = f * f,
            g = this.geometry;
        null === g.boundingSphere && g.computeBoundingSphere();
        c.copy(g.boundingSphere);
        c.applyMatrix4(this.matrixWorld);
        if (!1 !== d.ray.isIntersectionSphere(c) && (a.getInverse(this.matrixWorld), b.copy(d.ray).applyMatrix4(a), g instanceof THREE.Geometry))
            for (var g = g.vertices, h = g.length, k = new THREE.Vector3, l = new THREE.Vector3, p = this.type === THREE.LineStrip ?
                    1 : 2, q = 0; q < h - 1; q += p)
                if (!(b.distanceSqToSegment(g[q], g[q + 1], l, k) > f)) {
                    var r = b.origin.distanceTo(l);
                    r < d.near || r > d.far || e.push({
                        distance: r,
                        point: k.clone().applyMatrix4(this.matrixWorld),
                        face: null,
                        faceIndex: null,
                        object: this
                    })
                }
    }
}();
THREE.Line.prototype.clone = function(a) {
    void 0 === a && (a = new THREE.Line(this.geometry, this.material, this.type));
    THREE.Object3D.prototype.clone.call(this, a);
    return a
};
THREE.Mesh = function(a, b) {
    THREE.Object3D.call(this);
    this.geometry = void 0 !== a ? a : new THREE.Geometry;
    this.material = void 0 !== b ? b : new THREE.MeshBasicMaterial({
        color: 16777215 * Math.random()
    });
    this.updateMorphTargets()
};
THREE.Mesh.prototype = Object.create(THREE.Object3D.prototype);
THREE.Mesh.prototype.updateMorphTargets = function() {
    if (void 0 !== this.geometry.morphTargets && 0 < this.geometry.morphTargets.length) {
        this.morphTargetBase = -1;
        this.morphTargetForcedOrder = [];
        this.morphTargetInfluences = [];
        this.morphTargetDictionary = {};
        for (var a = 0, b = this.geometry.morphTargets.length; a < b; a++) this.morphTargetInfluences.push(0), this.morphTargetDictionary[this.geometry.morphTargets[a].name] = a
    }
};
THREE.Mesh.prototype.getMorphTargetIndexByName = function(a) {
    if (void 0 !== this.morphTargetDictionary[a]) return this.morphTargetDictionary[a];
    console.log("THREE.Mesh.getMorphTargetIndexByName: morph target " + a + " does not exist. Returning 0.");
    return 0
};
THREE.Mesh.prototype.raycast = function() {
    var a = new THREE.Matrix4,
        b = new THREE.Ray,
        c = new THREE.Sphere,
        d = new THREE.Vector3,
        e = new THREE.Vector3,
        f = new THREE.Vector3;
    return function(g, h) {
        var k = this.geometry;
        null === k.boundingSphere && k.computeBoundingSphere();
        c.copy(k.boundingSphere);
        c.applyMatrix4(this.matrixWorld);
        if (!1 !== g.ray.isIntersectionSphere(c) && (a.getInverse(this.matrixWorld), b.copy(g.ray).applyMatrix4(a), null === k.boundingBox || !1 !== b.isIntersectionBox(k.boundingBox)))
            if (k instanceof THREE.BufferGeometry) {
                var l =
                    this.material;
                if (void 0 !== l) {
                    var p = k.attributes,
                        q, r, t = g.precision;
                    if (void 0 !== p.index) {
                        var s = p.index.array,
                            n = p.position.array,
                            v = k.offsets;
                        0 === v.length && (v = [{
                            start: 0,
                            count: s.length,
                            index: 0
                        }]);
                        for (var w = 0, u = v.length; w < u; ++w)
                            for (var p = v[w].start, x = v[w].index, k = p, K = p + v[w].count; k < K; k += 3) {
                                p = x + s[k];
                                q = x + s[k + 1];
                                r = x + s[k + 2];
                                d.set(n[3 * p], n[3 * p + 1], n[3 * p + 2]);
                                e.set(n[3 * q], n[3 * q + 1], n[3 * q + 2]);
                                f.set(n[3 * r], n[3 * r + 1], n[3 * r + 2]);
                                var A = l.side === THREE.BackSide ? b.intersectTriangle(f, e, d, !0) : b.intersectTriangle(d, e, f, l.side !==
                                    THREE.DoubleSide);
                                if (null !== A) {
                                    A.applyMatrix4(this.matrixWorld);
                                    var G = g.ray.origin.distanceTo(A);
                                    G < t || G < g.near || G > g.far || h.push({
                                        distance: G,
                                        point: A,
                                        indices: [p, q, r],
                                        face: null,
                                        faceIndex: null,
                                        object: this
                                    })
                                }
                            }
                    } else
                        for (n = p.position.array, s = k = 0, K = n.length; k < K; k += 3, s += 9) p = k, q = k + 1, r = k + 2, d.set(n[s], n[s + 1], n[s + 2]), e.set(n[s + 3], n[s + 4], n[s + 5]), f.set(n[s + 6], n[s + 7], n[s + 8]), A = l.side === THREE.BackSide ? b.intersectTriangle(f, e, d, !0) : b.intersectTriangle(d, e, f, l.side !== THREE.DoubleSide), null !== A && (A.applyMatrix4(this.matrixWorld),
                            G = g.ray.origin.distanceTo(A), G < t || G < g.near || G > g.far || h.push({
                                distance: G,
                                point: A,
                                indices: [p, q, r],
                                face: null,
                                faceIndex: null,
                                object: this
                            }))
                }
            } else if (k instanceof THREE.Geometry)
            for (s = this.material instanceof THREE.MeshFaceMaterial, n = !0 === s ? this.material.materials : null, t = g.precision, v = k.vertices, w = 0, u = k.faces.length; w < u; w++)
                if (x = k.faces[w], l = !0 === s ? n[x.materialIndex] : this.material, void 0 !== l) {
                    p = v[x.a];
                    q = v[x.b];
                    r = v[x.c];
                    if (!0 === l.morphTargets) {
                        A = k.morphTargets;
                        G = this.morphTargetInfluences;
                        d.set(0, 0, 0);
                        e.set(0, 0, 0);
                        f.set(0, 0, 0);
                        for (var K = 0, B = A.length; K < B; K++) {
                            var C = G[K];
                            if (0 !== C) {
                                var E = A[K].vertices;
                                d.x += (E[x.a].x - p.x) * C;
                                d.y += (E[x.a].y - p.y) * C;
                                d.z += (E[x.a].z - p.z) * C;
                                e.x += (E[x.b].x - q.x) * C;
                                e.y += (E[x.b].y - q.y) * C;
                                e.z += (E[x.b].z - q.z) * C;
                                f.x += (E[x.c].x - r.x) * C;
                                f.y += (E[x.c].y - r.y) * C;
                                f.z += (E[x.c].z - r.z) * C
                            }
                        }
                        d.add(p);
                        e.add(q);
                        f.add(r);
                        p = d;
                        q = e;
                        r = f
                    }
                    A = l.side === THREE.BackSide ? b.intersectTriangle(r, q, p, !0) : b.intersectTriangle(p, q, r, l.side !== THREE.DoubleSide);
                    null !== A && (A.applyMatrix4(this.matrixWorld), G = g.ray.origin.distanceTo(A),
                        G < t || G < g.near || G > g.far || h.push({
                            distance: G,
                            point: A,
                            face: x,
                            faceIndex: w,
                            object: this
                        }))
                }
    }
}();
THREE.Mesh.prototype.clone = function(a, b) {
    void 0 === a && (a = new THREE.Mesh(this.geometry, this.material));
    THREE.Object3D.prototype.clone.call(this, a, b);
    return a
};
THREE.Bone = function(a) {
    THREE.Object3D.call(this);
    this.skin = a;
    this.skinMatrix = new THREE.Matrix4;
    this.accumulatedSclWeight = this.accumulatedPosWeight = this.accumulatedRotWeight = 0
};
THREE.Bone.prototype = Object.create(THREE.Object3D.prototype);
THREE.Bone.prototype.update = function(a, b) {
    this.matrixAutoUpdate && (b |= this.updateMatrix());
    if (b || this.matrixWorldNeedsUpdate) a ? this.skinMatrix.multiplyMatrices(a, this.matrix) : this.skinMatrix.copy(this.matrix), this.matrixWorldNeedsUpdate = !1, b = !0, this.accumulatedSclWeight = this.accumulatedPosWeight = this.accumulatedRotWeight = 0;
    for (var c = 0, d = this.children.length; c < d; c++) this.children[c].update(this.skinMatrix, b)
};
THREE.Skeleton = function(a, b) {
    this.useVertexTexture = void 0 !== b ? b : !0;
    this.bones = [];
    this.boneMatrices = [];
    var c, d, e, f, g;
    if (void 0 !== a) {
        for (var h = 0; h < a.length; ++h) d = a[h], e = d.pos, f = d.rotq, g = d.scl, c = this.addBone(), c.name = d.name, c.position.set(e[0], e[1], e[2]), c.quaternion.set(f[0], f[1], f[2], f[3]), void 0 !== g ? c.scale.set(g[0], g[1], g[2]) : c.scale.set(1, 1, 1);
        for (h = 0; h < a.length; ++h) d = a[h], -1 !== d.parent && this.bones[d.parent].add(this.bones[h]);
        c = this.bones.length;
        this.useVertexTexture ? (this.boneTextureHeight = this.boneTextureWidth =
            c = 256 < c ? 64 : 64 < c ? 32 : 16 < c ? 16 : 8, this.boneMatrices = new Float32Array(this.boneTextureWidth * this.boneTextureHeight * 4), this.boneTexture = new THREE.DataTexture(this.boneMatrices, this.boneTextureWidth, this.boneTextureHeight, THREE.RGBAFormat, THREE.FloatType), this.boneTexture.minFilter = THREE.NearestFilter, this.boneTexture.magFilter = THREE.NearestFilter, this.boneTexture.generateMipmaps = !1, this.boneTexture.flipY = !1) : this.boneMatrices = new Float32Array(16 * c)
    }
};
THREE.Skeleton.prototype = Object.create(THREE.Mesh.prototype);
THREE.Skeleton.prototype.addBone = function(a) {
    void 0 === a && (a = new THREE.Bone(this));
    this.bones.push(a);
    return a
};
THREE.Skeleton.prototype.calculateInverses = function(a) {
    this.boneInverses = [];
    a = 0;
    for (var b = this.bones.length; a < b; ++a) {
        var c = new THREE.Matrix4;
        c.getInverse(this.bones[a].skinMatrix);
        this.boneInverses.push(c)
    }
};
THREE.SkinnedMesh = function(a, b, c) {
    THREE.Mesh.call(this, a, b);
    this.skeleton = new THREE.Skeleton(this.geometry && this.geometry.bones, c);
    for (a = 0; a < this.skeleton.bones.length; ++a) b = this.skeleton.bones[a], void 0 === b.parent && this.add(b);
    this.identityMatrix = new THREE.Matrix4;
    this.pose()
};
THREE.SkinnedMesh.prototype = Object.create(THREE.Mesh.prototype);
THREE.SkinnedMesh.prototype.updateMatrixWorld = function() {
    var a = new THREE.Matrix4;
    return function(b) {
        this.matrixAutoUpdate && this.updateMatrix();
        if (this.matrixWorldNeedsUpdate || b) this.parent ? this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix) : this.matrixWorld.copy(this.matrix), this.matrixWorldNeedsUpdate = !1;
        b = 0;
        for (var c = this.children.length; b < c; b++) {
            var d = this.children[b];
            d instanceof THREE.Bone ? d.update(this.identityMatrix, !1) : d.updateMatrixWorld(!0)
        }
        void 0 === this.skeleton.boneInverses &&
            this.skeleton.calculateInverses();
        b = 0;
        for (c = this.skeleton.bones.length; b < c; b++) a.multiplyMatrices(this.skeleton.bones[b].skinMatrix, this.skeleton.boneInverses[b]), a.flattenToArrayOffset(this.skeleton.boneMatrices, 16 * b);
        this.skeleton.useVertexTexture && (this.skeleton.boneTexture.needsUpdate = !0)
    }
}();
THREE.SkinnedMesh.prototype.pose = function() {
    this.updateMatrixWorld(!0);
    this.normalizeSkinWeights()
};
THREE.SkinnedMesh.prototype.normalizeSkinWeights = function() {
    if (this.geometry instanceof THREE.Geometry)
        for (var a = 0; a < this.geometry.skinIndices.length; a++) {
            var b = this.geometry.skinWeights[a],
                c = 1 / b.lengthManhattan();
            Infinity !== c ? b.multiplyScalar(c) : b.set(1)
        }
};
THREE.SkinnedMesh.prototype.clone = function(a) {
    void 0 === a && (a = new THREE.SkinnedMesh(this.geometry, this.material, this.useVertexTexture));
    THREE.Mesh.prototype.clone.call(this, a);
    return a
};
THREE.MorphAnimMesh = function(a, b) {
    THREE.Mesh.call(this, a, b);
    this.duration = 1E3;
    this.mirroredLoop = !1;
    this.currentKeyframe = this.lastKeyframe = this.time = 0;
    this.direction = 1;
    this.directionBackwards = !1;
    this.setFrameRange(0, this.geometry.morphTargets.length - 1)
};
THREE.MorphAnimMesh.prototype = Object.create(THREE.Mesh.prototype);
THREE.MorphAnimMesh.prototype.setFrameRange = function(a, b) {
    this.startKeyframe = a;
    this.endKeyframe = b;
    this.length = this.endKeyframe - this.startKeyframe + 1
};
THREE.MorphAnimMesh.prototype.setDirectionForward = function() {
    this.direction = 1;
    this.directionBackwards = !1
};
THREE.MorphAnimMesh.prototype.setDirectionBackward = function() {
    this.direction = -1;
    this.directionBackwards = !0
};
THREE.MorphAnimMesh.prototype.parseAnimations = function() {
    var a = this.geometry;
    a.animations || (a.animations = {});
    for (var b, c = a.animations, d = /([a-z]+)_?(\d+)/, e = 0, f = a.morphTargets.length; e < f; e++) {
        var g = a.morphTargets[e].name.match(d);
        if (g && 1 < g.length) {
            g = g[1];
            c[g] || (c[g] = {
                start: Infinity,
                end: -Infinity
            });
            var h = c[g];
            e < h.start && (h.start = e);
            e > h.end && (h.end = e);
            b || (b = g)
        }
    }
    a.firstAnimation = b
};
THREE.MorphAnimMesh.prototype.setAnimationLabel = function(a, b, c) {
    this.geometry.animations || (this.geometry.animations = {});
    this.geometry.animations[a] = {
        start: b,
        end: c
    }
};
THREE.MorphAnimMesh.prototype.playAnimation = function(a, b) {
    var c = this.geometry.animations[a];
    c ? (this.setFrameRange(c.start, c.end), this.duration = (c.end - c.start) / b * 1E3, this.time = 0) : console.warn("animation[" + a + "] undefined")
};
THREE.MorphAnimMesh.prototype.updateAnimation = function(a) {
    var b = this.duration / this.length;
    this.time += this.direction * a;
    if (this.mirroredLoop) {
        if (this.time > this.duration || 0 > this.time) this.direction *= -1, this.time > this.duration && (this.time = this.duration, this.directionBackwards = !0), 0 > this.time && (this.time = 0, this.directionBackwards = !1)
    } else this.time %= this.duration, 0 > this.time && (this.time += this.duration);
    a = this.startKeyframe + THREE.Math.clamp(Math.floor(this.time / b), 0, this.length - 1);
    a !== this.currentKeyframe &&
        (this.morphTargetInfluences[this.lastKeyframe] = 0, this.morphTargetInfluences[this.currentKeyframe] = 1, this.morphTargetInfluences[a] = 0, this.lastKeyframe = this.currentKeyframe, this.currentKeyframe = a);
    b = this.time % b / b;
    this.directionBackwards && (b = 1 - b);
    this.morphTargetInfluences[this.currentKeyframe] = b;
    this.morphTargetInfluences[this.lastKeyframe] = 1 - b
};
THREE.MorphAnimMesh.prototype.clone = function(a) {
    void 0 === a && (a = new THREE.MorphAnimMesh(this.geometry, this.material));
    a.duration = this.duration;
    a.mirroredLoop = this.mirroredLoop;
    a.time = this.time;
    a.lastKeyframe = this.lastKeyframe;
    a.currentKeyframe = this.currentKeyframe;
    a.direction = this.direction;
    a.directionBackwards = this.directionBackwards;
    THREE.Mesh.prototype.clone.call(this, a);
    return a
};
THREE.LOD = function() {
    THREE.Object3D.call(this);
    this.objects = []
};
THREE.LOD.prototype = Object.create(THREE.Object3D.prototype);
THREE.LOD.prototype.addLevel = function(a, b) {
    void 0 === b && (b = 0);
    b = Math.abs(b);
    for (var c = 0; c < this.objects.length && !(b < this.objects[c].distance); c++);
    this.objects.splice(c, 0, {
        distance: b,
        object: a
    });
    this.add(a)
};
THREE.LOD.prototype.getObjectForDistance = function(a) {
    for (var b = 1, c = this.objects.length; b < c && !(a < this.objects[b].distance); b++);
    return this.objects[b - 1].object
};
THREE.LOD.prototype.raycast = function() {
    var a = new THREE.Vector3;
    return function(b, c) {
        a.setFromMatrixPosition(this.matrixWorld);
        var d = b.ray.origin.distanceTo(a);
        this.getObjectForDistance(d).raycast(b, c)
    }
}();
THREE.LOD.prototype.update = function() {
    var a = new THREE.Vector3,
        b = new THREE.Vector3;
    return function(c) {
        if (1 < this.objects.length) {
            a.setFromMatrixPosition(c.matrixWorld);
            b.setFromMatrixPosition(this.matrixWorld);
            c = a.distanceTo(b);
            this.objects[0].object.visible = !0;
            for (var d = 1, e = this.objects.length; d < e; d++)
                if (c >= this.objects[d].distance) this.objects[d - 1].object.visible = !1, this.objects[d].object.visible = !0;
                else break;
            for (; d < e; d++) this.objects[d].object.visible = !1
        }
    }
}();
THREE.LOD.prototype.clone = function(a) {
    void 0 === a && (a = new THREE.LOD);
    THREE.Object3D.prototype.clone.call(this, a);
    for (var b = 0, c = this.objects.length; b < c; b++) {
        var d = this.objects[b].object.clone();
        d.visible = 0 === b;
        a.addLevel(d, this.objects[b].distance)
    }
    return a
};
THREE.Sprite = function() {
    var a = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0]),
        b = new THREE.BufferGeometry;
    b.addAttribute("position", new THREE.BufferAttribute(a, 3));
    return function(a) {
        THREE.Object3D.call(this);
        this.geometry = b;
        this.material = void 0 !== a ? a : new THREE.SpriteMaterial
    }
}();
THREE.Sprite.prototype = Object.create(THREE.Object3D.prototype);
THREE.Sprite.prototype.raycast = function() {
    var a = new THREE.Vector3;
    return function(b, c) {
        a.setFromMatrixPosition(this.matrixWorld);
        var d = b.ray.distanceToPoint(a);
        d > this.scale.x || c.push({
            distance: d,
            point: this.position,
            face: null,
            object: this
        })
    }
}();
THREE.Sprite.prototype.updateMatrix = function() {
    this.matrix.compose(this.position, this.quaternion, this.scale);
    this.matrixWorldNeedsUpdate = !0
};
THREE.Sprite.prototype.clone = function(a) {
    void 0 === a && (a = new THREE.Sprite(this.material));
    THREE.Object3D.prototype.clone.call(this, a);
    return a
};
THREE.Particle = THREE.Sprite;
THREE.Scene = function() {
    THREE.Object3D.call(this);
    this.overrideMaterial = this.fog = null;
    this.autoUpdate = !0;
    this.matrixAutoUpdate = !1;
    this.__lights = [];
    this.__objectsAdded = [];
    this.__objectsRemoved = []
};
THREE.Scene.prototype = Object.create(THREE.Object3D.prototype);
THREE.Scene.prototype.__addObject = function(a) {
    if (a instanceof THREE.Light) - 1 === this.__lights.indexOf(a) && this.__lights.push(a), a.target && void 0 === a.target.parent && this.add(a.target);
    else if (!(a instanceof THREE.Camera || a instanceof THREE.Bone)) {
        this.__objectsAdded.push(a);
        var b = this.__objectsRemoved.indexOf(a); - 1 !== b && this.__objectsRemoved.splice(b, 1)
    }
    this.dispatchEvent({
        type: "objectAdded",
        object: a
    });
    a.dispatchEvent({
        type: "addedToScene",
        scene: this
    });
    for (b = 0; b < a.children.length; b++) this.__addObject(a.children[b])
};
THREE.Scene.prototype.__removeObject = function(a) {
    if (a instanceof THREE.Light) {
        var b = this.__lights.indexOf(a); - 1 !== b && this.__lights.splice(b, 1);
        if (a.shadowCascadeArray)
            for (b = 0; b < a.shadowCascadeArray.length; b++) this.__removeObject(a.shadowCascadeArray[b])
    } else a instanceof THREE.Camera || (this.__objectsRemoved.push(a), b = this.__objectsAdded.indexOf(a), -1 !== b && this.__objectsAdded.splice(b, 1));
    this.dispatchEvent({
        type: "objectRemoved",
        object: a
    });
    a.dispatchEvent({
        type: "removedFromScene",
        scene: this
    });
    for (b =
        0; b < a.children.length; b++) this.__removeObject(a.children[b])
};
THREE.Scene.prototype.clone = function(a) {
    void 0 === a && (a = new THREE.Scene);
    THREE.Object3D.prototype.clone.call(this, a);
    null !== this.fog && (a.fog = this.fog.clone());
    null !== this.overrideMaterial && (a.overrideMaterial = this.overrideMaterial.clone());
    a.autoUpdate = this.autoUpdate;
    a.matrixAutoUpdate = this.matrixAutoUpdate;
    return a
};
THREE.Fog = function(a, b, c) {
    this.name = "";
    this.color = new THREE.Color(a);
    this.near = void 0 !== b ? b : 1;
    this.far = void 0 !== c ? c : 1E3
};
THREE.Fog.prototype.clone = function() {
    return new THREE.Fog(this.color.getHex(), this.near, this.far)
};
THREE.FogExp2 = function(a, b) {
    this.name = "";
    this.color = new THREE.Color(a);
    this.density = void 0 !== b ? b : 2.5E-4
};
THREE.FogExp2.prototype.clone = function() {
    return new THREE.FogExp2(this.color.getHex(), this.density)
};
THREE.CanvasRenderer = function(a) {
    function b(a, b, c, d) {
        l(b);
        p(c);
        q(d);
        r(a.getStyle());
        H.stroke();
        ma.expandByScalar(2 * b)
    }

    function c(a) {
        t(a.getStyle());
        H.fill()
    }

    function d(a) {
        e(a.target)
    }

    function e(a) {
        var b = a.wrapS === THREE.RepeatWrapping,
            c = a.wrapT === THREE.RepeatWrapping,
            d = a.image,
            e = document.createElement("canvas");
        e.width = d.width;
        e.height = d.height;
        var f = e.getContext("2d");
        f.setTransform(1, 0, 0, -1, 0, d.height);
        f.drawImage(d, 0, 0);
        Ea[a.id] = H.createPattern(e, !0 === b && !0 === c ? "repeat" : !0 === b && !1 === c ? "repeat-x" :
            !1 === b && !0 === c ? "repeat-y" : "no-repeat")
    }

    function f(a, b, c, f, g, h, k, l, n, p, m, r, q) {
        if (!(q instanceof THREE.DataTexture)) {
            !1 === q.hasEventListener("update", d) && (void 0 !== q.image && 0 < q.image.width && e(q), q.addEventListener("update", d));
            var s = Ea[q.id];
            if (void 0 !== s) {
                t(s);
                var s = q.offset.x / q.repeat.x,
                    u = q.offset.y / q.repeat.y,
                    v = q.image.width * q.repeat.x;
                q = q.image.height * q.repeat.y;
                k = (k + s) * v;
                l = (l + u) * q;
                c -= a;
                f -= b;
                g -= a;
                h -= b;
                n = (n + s) * v - k;
                p = (p + u) * q - l;
                m = (m + s) * v - k;
                r = (r + u) * q - l;
                q = n * r - m * p;
                0 !== q && (s = 1 / q, q = (r * c - p * g) * s, p = (r * f - p *
                    h) * s, c = (n * g - m * c) * s, f = (n * h - m * f) * s, a = a - q * k - c * l, b = b - p * k - f * l, H.save(), H.transform(q, p, c, f, a, b), H.fill(), H.restore())
            } else t("rgba(0,0,0,1)"), H.fill()
        }
    }

    function g(a, b, c) {
        var d = b.x - a.x,
            e = b.y - a.y,
            f = d * d + e * e;
        0 !== f && (c /= Math.sqrt(f), d *= c, e *= c, b.x += d, b.y += e, a.x -= d, a.y -= e)
    }

    function h(a) {
        z !== a && (z = H.globalAlpha = a)
    }

    function k(a) {
        R !== a && (a === THREE.NormalBlending ? H.globalCompositeOperation = "source-over" : a === THREE.AdditiveBlending ? H.globalCompositeOperation = "lighter" : a === THREE.SubtractiveBlending && (H.globalCompositeOperation =
            "darker"), R = a)
    }

    function l(a) {
        F !== a && (F = H.lineWidth = a)
    }

    function p(a) {
        P !== a && (P = H.lineCap = a)
    }

    function q(a) {
        X !== a && (X = H.lineJoin = a)
    }

    function r(a) {
        L !== a && (L = H.strokeStyle = a)
    }

    function t(a) {
        I !== a && (I = H.fillStyle = a)
    }

    function s(a) {
        N.length !== a.length && (H.setLineDash(a), N = a)
    }
    console.log("THREE.CanvasRenderer", THREE.REVISION);
    var n = THREE.Math.smoothstep;
    a = a || {};
    var v = this,
        w, u, x, K = new THREE.Projector,
        A = void 0 !== a.canvas ? a.canvas : document.createElement("canvas"),
        G = A.width,
        B = A.height,
        C = Math.floor(G / 2),
        E = Math.floor(B /
            2),
        H = A.getContext("2d", {
            alpha: !0 === a.alpha
        }),
        y = new THREE.Color(0),
        Q = 0,
        z = 1,
        R = 0,
        L = null,
        I = null,
        F = null,
        P = null,
        X = null,
        N = [],
        la, S, W, D;
    new THREE.RenderableVertex;
    new THREE.RenderableVertex;
    var ha, fa, U, M, da, wa, ia = new THREE.Color;
    new THREE.Color;
    new THREE.Color;
    new THREE.Color;
    new THREE.Color;
    var xa = new THREE.Color,
        Ca = new THREE.Color,
        Ha = new THREE.Color,
        Ea = {},
        ba, La, Pa, Sa, Ta, Ja, ja, za = new THREE.Box2,
        ca = new THREE.Box2,
        ma = new THREE.Box2,
        oa = new THREE.Color,
        ua = new THREE.Color,
        Da = new THREE.Color,
        Ka = new THREE.Vector3,
        Fa = new THREE.Vector3,
        ea = new THREE.Vector3,
        va = new THREE.Matrix3;
    void 0 === H.setLineDash && (H.setLineDash = function() {});
    this.domElement = A;
    this.devicePixelRatio = void 0 !== a.devicePixelRatio ? a.devicePixelRatio : void 0 !== self.devicePixelRatio ? self.devicePixelRatio : 1;
    this.sortElements = this.sortObjects = this.autoClear = !0;
    this.info = {
        render: {
            vertices: 0,
            faces: 0
        }
    };
    this.supportsVertexTextures = function() {};
    this.setFaceCulling = function() {};
    this.setSize = function(a, b, c) {
        G = a * this.devicePixelRatio;
        B = b * this.devicePixelRatio;
        A.width = G;
        A.height = B;
        C = Math.floor(G / 2);
        E = Math.floor(B / 2);
        !1 !== c && (A.style.width = a + "px", A.style.height = b + "px");
        za.min.set(-C, -E);
        za.max.set(C, E);
        ca.min.set(-C, -E);
        ca.max.set(C, E);
        z = 1;
        R = 0;
        X = P = F = I = L = null;
        this.setViewport(0, 0, a, b)
    };
    this.setViewport = function(a, b, c, d) {
        H.setTransform(c * this.devicePixelRatio / G, 0, 0, -(d * this.devicePixelRatio) / B, a * this.devicePixelRatio, B - b * this.devicePixelRatio);
        H.translate(C, E)
    };
    this.setScissor = function() {};
    this.enableScissorTest = function() {};
    this.setClearColor = function(a,
        b) {
        y.set(a);
        Q = void 0 !== b ? b : 1;
        ca.min.set(-C, -E);
        ca.max.set(C, E)
    };
    this.setClearColorHex = function(a, b) {
        console.warn("THREE.CanvasRenderer: .setClearColorHex() is being removed. Use .setClearColor() instead.");
        this.setClearColor(a, b)
    };
    this.getMaxAnisotropy = function() {
        return 0
    };
    this.clear = function() {
        !1 === ca.empty() && (ca.intersect(za), ca.expandByScalar(2), 1 > Q && H.clearRect(ca.min.x | 0, ca.min.y | 0, ca.max.x - ca.min.x | 0, ca.max.y - ca.min.y | 0), 0 < Q && (k(THREE.NormalBlending), h(1), t("rgba(" + Math.floor(255 * y.r) + "," +
            Math.floor(255 * y.g) + "," + Math.floor(255 * y.b) + "," + Q + ")"), H.fillRect(ca.min.x | 0, ca.min.y | 0, ca.max.x - ca.min.x | 0, ca.max.y - ca.min.y | 0)), ca.makeEmpty())
    };
    this.clearColor = function() {};
    this.clearDepth = function() {};
    this.clearStencil = function() {};
    this.render = function(a, A) {
        if (!1 === A instanceof THREE.Camera) console.error("THREE.CanvasRenderer.render: camera is not an instance of THREE.Camera.");
        else {
            !0 === this.autoClear && this.clear();
            v.info.render.vertices = 0;
            v.info.render.faces = 0;
            w = K.projectScene(a, A, this.sortObjects,
                this.sortElements);
            u = w.elements;
            x = w.lights;
            la = A;
            va.getNormalMatrix(A.matrixWorldInverse);
            oa.setRGB(0, 0, 0);
            ua.setRGB(0, 0, 0);
            Da.setRGB(0, 0, 0);
            for (var B = 0, I = x.length; B < I; B++) {
                var y = x[B],
                    G = y.color;
                y instanceof THREE.AmbientLight ? oa.add(G) : y instanceof THREE.DirectionalLight ? ua.add(G) : y instanceof THREE.PointLight && Da.add(G)
            }
            B = 0;
            for (I = u.length; B < I; B++) {
                var F = u[B],
                    P = F.material;
                if (void 0 !== P && 0 !== P.opacity) {
                    ma.makeEmpty();
                    if (F instanceof THREE.RenderableSprite) {
                        S = F;
                        S.x *= C;
                        S.y *= E;
                        var y = S,
                            L = F,
                            G = P;
                        h(G.opacity);
                        k(G.blending);
                        var z = L.scale.x * C,
                            L = L.scale.y * E,
                            F = 0.5 * Math.sqrt(z * z + L * L);
                        ma.min.set(y.x - F, y.y - F);
                        ma.max.set(y.x + F, y.y + F);
                        if (G instanceof THREE.SpriteMaterial) {
                            var m = G.map;
                            if (null !== m && void 0 !== m.image) {
                                !1 === m.hasEventListener("update", d) && (0 < m.image.width && e(m), m.addEventListener("update", d));
                                F = Ea[m.id];
                                void 0 !== F ? t(F) : t("rgba( 0, 0, 0, 1 )");
                                var Q = m.image,
                                    F = Q.width * m.offset.x,
                                    P = Q.height * m.offset.y,
                                    N = Q.width * m.repeat.x,
                                    m = Q.height * m.repeat.y,
                                    Q = z / N,
                                    R = L / m;
                                H.save();
                                H.translate(y.x, y.y);
                                0 !== G.rotation &&
                                    H.rotate(G.rotation);
                                H.translate(-z / 2, -L / 2);
                                H.scale(Q, R);
                                H.translate(-F, -P);
                                H.fillRect(F, P, N, m)
                            } else t(G.color.getStyle()), H.save(), H.translate(y.x, y.y), 0 !== G.rotation && H.rotate(G.rotation), H.scale(z, -L), H.fillRect(-0.5, -0.5, 1, 1);
                            H.restore()
                        } else G instanceof THREE.SpriteCanvasMaterial && (r(G.color.getStyle()), t(G.color.getStyle()), H.save(), H.translate(y.x, y.y), 0 !== G.rotation && H.rotate(G.rotation), H.scale(z, L), G.program(H), H.restore())
                    } else if (F instanceof THREE.RenderableLine) {
                        if (S = F.v1, W = F.v2, S.positionScreen.x *=
                            C, S.positionScreen.y *= E, W.positionScreen.x *= C, W.positionScreen.y *= E, ma.setFromPoints([S.positionScreen, W.positionScreen]), !0 === za.isIntersectionBox(ma))
                            if (y = S, G = W, z = F, L = P, h(L.opacity), k(L.blending), H.beginPath(), H.moveTo(y.positionScreen.x, y.positionScreen.y), H.lineTo(G.positionScreen.x, G.positionScreen.y), L instanceof THREE.LineBasicMaterial) {
                                l(L.linewidth);
                                p(L.linecap);
                                q(L.linejoin);
                                if (L.vertexColors !== THREE.VertexColors) r(L.color.getStyle());
                                else if (F = z.vertexColors[0].getStyle(), z = z.vertexColors[1].getStyle(),
                                    F === z) r(F);
                                else {
                                    try {
                                        var X = H.createLinearGradient(y.positionScreen.x, y.positionScreen.y, G.positionScreen.x, G.positionScreen.y);
                                        X.addColorStop(0, F);
                                        X.addColorStop(1, z)
                                    } catch (rb) {
                                        X = F
                                    }
                                    r(X)
                                }
                                H.stroke();
                                ma.expandByScalar(2 * L.linewidth)
                            } else L instanceof THREE.LineDashedMaterial && (l(L.linewidth), p(L.linecap), q(L.linejoin), r(L.color.getStyle()), s([L.dashSize, L.gapSize]), H.stroke(), ma.expandByScalar(2 * L.linewidth), s([]))
                    } else if (F instanceof THREE.RenderableFace) {
                        S = F.v1;
                        W = F.v2;
                        D = F.v3;
                        if (-1 > S.positionScreen.z ||
                            1 < S.positionScreen.z) continue;
                        if (-1 > W.positionScreen.z || 1 < W.positionScreen.z) continue;
                        if (-1 > D.positionScreen.z || 1 < D.positionScreen.z) continue;
                        S.positionScreen.x *= C;
                        S.positionScreen.y *= E;
                        W.positionScreen.x *= C;
                        W.positionScreen.y *= E;
                        D.positionScreen.x *= C;
                        D.positionScreen.y *= E;
                        0 < P.overdraw && (g(S.positionScreen, W.positionScreen, P.overdraw), g(W.positionScreen, D.positionScreen, P.overdraw), g(D.positionScreen, S.positionScreen, P.overdraw));
                        ma.setFromPoints([S.positionScreen, W.positionScreen, D.positionScreen]);
                        if (!0 === za.isIntersectionBox(ma)) {
                            G = S;
                            z = W;
                            L = D;
                            y = P;
                            v.info.render.vertices += 3;
                            v.info.render.faces++;
                            h(y.opacity);
                            k(y.blending);
                            ha = G.positionScreen.x;
                            fa = G.positionScreen.y;
                            U = z.positionScreen.x;
                            M = z.positionScreen.y;
                            da = L.positionScreen.x;
                            wa = L.positionScreen.y;
                            var P = ha,
                                N = fa,
                                m = U,
                                Q = M,
                                R = da,
                                mb = wa;
                            H.beginPath();
                            H.moveTo(P, N);
                            H.lineTo(m, Q);
                            H.lineTo(R, mb);
                            H.closePath();
                            if ((y instanceof THREE.MeshLambertMaterial || y instanceof THREE.MeshPhongMaterial) && null === y.map) {
                                xa.copy(y.color);
                                Ca.copy(y.emissive);
                                y.vertexColors ===
                                    THREE.FaceColors && xa.multiply(F.color);
                                ia.copy(oa);
                                Fa.copy(G.positionWorld).add(z.positionWorld).add(L.positionWorld).divideScalar(3);
                                G = Fa;
                                z = F.normalModel;
                                L = ia;
                                F = 0;
                                for (P = x.length; F < P; F++) N = x[F], Ha.copy(N.color), N instanceof THREE.DirectionalLight ? (m = Ka.setFromMatrixPosition(N.matrixWorld).normalize(), Q = z.dot(m), 0 >= Q || (Q *= N.intensity, L.add(Ha.multiplyScalar(Q)))) : N instanceof THREE.PointLight && (m = Ka.setFromMatrixPosition(N.matrixWorld), Q = z.dot(Ka.subVectors(m, G).normalize()), 0 >= Q || (Q *= 0 == N.distance ?
                                    1 : 1 - Math.min(G.distanceTo(m) / N.distance, 1), 0 != Q && (Q *= N.intensity, L.add(Ha.multiplyScalar(Q)))));
                                ia.multiply(xa).add(Ca);
                                !0 === y.wireframe ? b(ia, y.wireframeLinewidth, y.wireframeLinecap, y.wireframeLinejoin) : c(ia)
                            } else y instanceof THREE.MeshBasicMaterial || y instanceof THREE.MeshLambertMaterial || y instanceof THREE.MeshPhongMaterial ? null !== y.map ? y.map.mapping instanceof THREE.UVMapping && (ba = F.uvs, f(ha, fa, U, M, da, wa, ba[0].x, ba[0].y, ba[1].x, ba[1].y, ba[2].x, ba[2].y, y.map)) : null !== y.envMap ? y.envMap.mapping instanceof
                            THREE.SphericalReflectionMapping ? (ea.copy(F.vertexNormalsModel[0]).applyMatrix3(va), La = 0.5 * ea.x + 0.5, Pa = 0.5 * ea.y + 0.5, ea.copy(F.vertexNormalsModel[1]).applyMatrix3(va), Sa = 0.5 * ea.x + 0.5, Ta = 0.5 * ea.y + 0.5, ea.copy(F.vertexNormalsModel[2]).applyMatrix3(va), Ja = 0.5 * ea.x + 0.5, ja = 0.5 * ea.y + 0.5, f(ha, fa, U, M, da, wa, La, Pa, Sa, Ta, Ja, ja, y.envMap)) : y.envMap.mapping instanceof THREE.SphericalRefractionMapping && (ea.copy(F.vertexNormalsModel[0]).applyMatrix3(va), La = -0.5 * ea.x + 0.5, Pa = -0.5 * ea.y + 0.5, ea.copy(F.vertexNormalsModel[1]).applyMatrix3(va),
                                Sa = -0.5 * ea.x + 0.5, Ta = -0.5 * ea.y + 0.5, ea.copy(F.vertexNormalsModel[2]).applyMatrix3(va), Ja = -0.5 * ea.x + 0.5, ja = -0.5 * ea.y + 0.5, f(ha, fa, U, M, da, wa, La, Pa, Sa, Ta, Ja, ja, y.envMap)): (ia.copy(y.color), y.vertexColors === THREE.FaceColors && ia.multiply(F.color), !0 === y.wireframe ? b(ia, y.wireframeLinewidth, y.wireframeLinecap, y.wireframeLinejoin) : c(ia)): (y instanceof THREE.MeshDepthMaterial ? ia.r = ia.g = ia.b = 1 - n(G.positionScreen.z * G.positionScreen.w, la.near, la.far) : y instanceof THREE.MeshNormalMaterial ? (ea.copy(F.normalModel).applyMatrix3(va),
                                ia.setRGB(ea.x, ea.y, ea.z).multiplyScalar(0.5).addScalar(0.5)) : ia.setRGB(1, 1, 1), !0 === y.wireframe ? b(ia, y.wireframeLinewidth, y.wireframeLinecap, y.wireframeLinejoin) : c(ia))
                        }
                    }
                    ca.union(ma)
                }
            }
        }
    }
};
THREE.ShaderChunk = {
    fog_pars_fragment: "#ifdef USE_FOG\n\tuniform vec3 fogColor;\n\t#ifdef FOG_EXP2\n\t\tuniform float fogDensity;\n\t#else\n\t\tuniform float fogNear;\n\t\tuniform float fogFar;\n\t#endif\n#endif",
    fog_fragment: "#ifdef USE_FOG\n\t#ifdef USE_LOGDEPTHBUF_EXT\n\t\tfloat depth = gl_FragDepthEXT / gl_FragCoord.w;\n\t#else\n\t\tfloat depth = gl_FragCoord.z / gl_FragCoord.w;\n\t#endif\n\t#ifdef FOG_EXP2\n\t\tconst float LOG2 = 1.442695;\n\t\tfloat fogFactor = exp2( - fogDensity * fogDensity * depth * depth * LOG2 );\n\t\tfogFactor = 1.0 - clamp( fogFactor, 0.0, 1.0 );\n\t#else\n\t\tfloat fogFactor = smoothstep( fogNear, fogFar, depth );\n\t#endif\n\tgl_FragColor = mix( gl_FragColor, vec4( fogColor, gl_FragColor.w ), fogFactor );\n#endif",
    envmap_pars_fragment: "#ifdef USE_ENVMAP\n\tuniform float reflectivity;\n\tuniform samplerCube envMap;\n\tuniform float flipEnvMap;\n\tuniform int combine;\n\t#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP )\n\t\tuniform bool useRefract;\n\t\tuniform float refractionRatio;\n\t#else\n\t\tvarying vec3 vReflect;\n\t#endif\n#endif",
    envmap_fragment: "#ifdef USE_ENVMAP\n\tvec3 reflectVec;\n\t#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP )\n\t\tvec3 cameraToVertex = normalize( vWorldPosition - cameraPosition );\n\t\tvec3 worldNormal = normalize( vec3( vec4( normal, 0.0 ) * viewMatrix ) );\n\t\tif ( useRefract ) {\n\t\t\treflectVec = refract( cameraToVertex, worldNormal, refractionRatio );\n\t\t} else { \n\t\t\treflectVec = reflect( cameraToVertex, worldNormal );\n\t\t}\n\t#else\n\t\treflectVec = vReflect;\n\t#endif\n\t#ifdef DOUBLE_SIDED\n\t\tfloat flipNormal = ( -1.0 + 2.0 * float( gl_FrontFacing ) );\n\t\tvec4 cubeColor = textureCube( envMap, flipNormal * vec3( flipEnvMap * reflectVec.x, reflectVec.yz ) );\n\t#else\n\t\tvec4 cubeColor = textureCube( envMap, vec3( flipEnvMap * reflectVec.x, reflectVec.yz ) );\n\t#endif\n\t#ifdef GAMMA_INPUT\n\t\tcubeColor.xyz *= cubeColor.xyz;\n\t#endif\n\tif ( combine == 1 ) {\n\t\tgl_FragColor.xyz = mix( gl_FragColor.xyz, cubeColor.xyz, specularStrength * reflectivity );\n\t} else if ( combine == 2 ) {\n\t\tgl_FragColor.xyz += cubeColor.xyz * specularStrength * reflectivity;\n\t} else {\n\t\tgl_FragColor.xyz = mix( gl_FragColor.xyz, gl_FragColor.xyz * cubeColor.xyz, specularStrength * reflectivity );\n\t}\n#endif",
    envmap_pars_vertex: "#if defined( USE_ENVMAP ) && ! defined( USE_BUMPMAP ) && ! defined( USE_NORMALMAP )\n\tvarying vec3 vReflect;\n\tuniform float refractionRatio;\n\tuniform bool useRefract;\n#endif",
    worldpos_vertex: "#if defined( USE_ENVMAP ) || defined( PHONG ) || defined( LAMBERT ) || defined ( USE_SHADOWMAP )\n\t#ifdef USE_SKINNING\n\t\tvec4 worldPosition = modelMatrix * skinned;\n\t#endif\n\t#if defined( USE_MORPHTARGETS ) && ! defined( USE_SKINNING )\n\t\tvec4 worldPosition = modelMatrix * vec4( morphed, 1.0 );\n\t#endif\n\t#if ! defined( USE_MORPHTARGETS ) && ! defined( USE_SKINNING )\n\t\tvec4 worldPosition = modelMatrix * vec4( position, 1.0 );\n\t#endif\n#endif",
    envmap_vertex: "#if defined( USE_ENVMAP ) && ! defined( USE_BUMPMAP ) && ! defined( USE_NORMALMAP )\n\tvec3 worldNormal = mat3( modelMatrix[ 0 ].xyz, modelMatrix[ 1 ].xyz, modelMatrix[ 2 ].xyz ) * objectNormal;\n\tworldNormal = normalize( worldNormal );\n\tvec3 cameraToVertex = normalize( worldPosition.xyz - cameraPosition );\n\tif ( useRefract ) {\n\t\tvReflect = refract( cameraToVertex, worldNormal, refractionRatio );\n\t} else {\n\t\tvReflect = reflect( cameraToVertex, worldNormal );\n\t}\n#endif",
    map_particle_pars_fragment: "#ifdef USE_MAP\n\tuniform sampler2D map;\n#endif",
    map_particle_fragment: "#ifdef USE_MAP\n\tgl_FragColor = gl_FragColor * texture2D( map, vec2( gl_PointCoord.x, 1.0 - gl_PointCoord.y ) );\n#endif",
    map_pars_vertex: "#if defined( USE_MAP ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( USE_SPECULARMAP )\n\tvarying vec2 vUv;\n\tuniform vec4 offsetRepeat;\n#endif",
    map_pars_fragment: "#if defined( USE_MAP ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( USE_SPECULARMAP )\n\tvarying vec2 vUv;\n#endif\n#ifdef USE_MAP\n\tuniform sampler2D map;\n#endif",
    map_vertex: "#if defined( USE_MAP ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( USE_SPECULARMAP )\n\tvUv = uv * offsetRepeat.zw + offsetRepeat.xy;\n#endif",
    map_fragment: "#ifdef USE_MAP\n\tvec4 texelColor = texture2D( map, vUv );\n\t#ifdef GAMMA_INPUT\n\t\ttexelColor.xyz *= texelColor.xyz;\n\t#endif\n\tgl_FragColor = gl_FragColor * texelColor;\n#endif",
    lightmap_pars_fragment: "#ifdef USE_LIGHTMAP\n\tvarying vec2 vUv2;\n\tuniform sampler2D lightMap;\n#endif",
    lightmap_pars_vertex: "#ifdef USE_LIGHTMAP\n\tvarying vec2 vUv2;\n#endif",
    lightmap_fragment: "#ifdef USE_LIGHTMAP\n\tgl_FragColor = gl_FragColor * texture2D( lightMap, vUv2 );\n#endif",
    lightmap_vertex: "#ifdef USE_LIGHTMAP\n\tvUv2 = uv2;\n#endif",
    bumpmap_pars_fragment: "#ifdef USE_BUMPMAP\n\tuniform sampler2D bumpMap;\n\tuniform float bumpScale;\n\tvec2 dHdxy_fwd() {\n\t\tvec2 dSTdx = dFdx( vUv );\n\t\tvec2 dSTdy = dFdy( vUv );\n\t\tfloat Hll = bumpScale * texture2D( bumpMap, vUv ).x;\n\t\tfloat dBx = bumpScale * texture2D( bumpMap, vUv + dSTdx ).x - Hll;\n\t\tfloat dBy = bumpScale * texture2D( bumpMap, vUv + dSTdy ).x - Hll;\n\t\treturn vec2( dBx, dBy );\n\t}\n\tvec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy ) {\n\t\tvec3 vSigmaX = dFdx( surf_pos );\n\t\tvec3 vSigmaY = dFdy( surf_pos );\n\t\tvec3 vN = surf_norm;\n\t\tvec3 R1 = cross( vSigmaY, vN );\n\t\tvec3 R2 = cross( vN, vSigmaX );\n\t\tfloat fDet = dot( vSigmaX, R1 );\n\t\tvec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );\n\t\treturn normalize( abs( fDet ) * surf_norm - vGrad );\n\t}\n#endif",
    normalmap_pars_fragment: "#ifdef USE_NORMALMAP\n\tuniform sampler2D normalMap;\n\tuniform vec2 normalScale;\n\tvec3 perturbNormal2Arb( vec3 eye_pos, vec3 surf_norm ) {\n\t\tvec3 q0 = dFdx( eye_pos.xyz );\n\t\tvec3 q1 = dFdy( eye_pos.xyz );\n\t\tvec2 st0 = dFdx( vUv.st );\n\t\tvec2 st1 = dFdy( vUv.st );\n\t\tvec3 S = normalize( q0 * st1.t - q1 * st0.t );\n\t\tvec3 T = normalize( -q0 * st1.s + q1 * st0.s );\n\t\tvec3 N = normalize( surf_norm );\n\t\tvec3 mapN = texture2D( normalMap, vUv ).xyz * 2.0 - 1.0;\n\t\tmapN.xy = normalScale * mapN.xy;\n\t\tmat3 tsn = mat3( S, T, N );\n\t\treturn normalize( tsn * mapN );\n\t}\n#endif",
    specularmap_pars_fragment: "#ifdef USE_SPECULARMAP\n\tuniform sampler2D specularMap;\n#endif",
    specularmap_fragment: "float specularStrength;\n#ifdef USE_SPECULARMAP\n\tvec4 texelSpecular = texture2D( specularMap, vUv );\n\tspecularStrength = texelSpecular.r;\n#else\n\tspecularStrength = 1.0;\n#endif",
    lights_lambert_pars_vertex: "uniform vec3 ambient;\nuniform vec3 diffuse;\nuniform vec3 emissive;\nuniform vec3 ambientLightColor;\n#if MAX_DIR_LIGHTS > 0\n\tuniform vec3 directionalLightColor[ MAX_DIR_LIGHTS ];\n\tuniform vec3 directionalLightDirection[ MAX_DIR_LIGHTS ];\n#endif\n#if MAX_HEMI_LIGHTS > 0\n\tuniform vec3 hemisphereLightSkyColor[ MAX_HEMI_LIGHTS ];\n\tuniform vec3 hemisphereLightGroundColor[ MAX_HEMI_LIGHTS ];\n\tuniform vec3 hemisphereLightDirection[ MAX_HEMI_LIGHTS ];\n#endif\n#if MAX_POINT_LIGHTS > 0\n\tuniform vec3 pointLightColor[ MAX_POINT_LIGHTS ];\n\tuniform vec3 pointLightPosition[ MAX_POINT_LIGHTS ];\n\tuniform float pointLightDistance[ MAX_POINT_LIGHTS ];\n#endif\n#if MAX_SPOT_LIGHTS > 0\n\tuniform vec3 spotLightColor[ MAX_SPOT_LIGHTS ];\n\tuniform vec3 spotLightPosition[ MAX_SPOT_LIGHTS ];\n\tuniform vec3 spotLightDirection[ MAX_SPOT_LIGHTS ];\n\tuniform float spotLightDistance[ MAX_SPOT_LIGHTS ];\n\tuniform float spotLightAngleCos[ MAX_SPOT_LIGHTS ];\n\tuniform float spotLightExponent[ MAX_SPOT_LIGHTS ];\n#endif\n#ifdef WRAP_AROUND\n\tuniform vec3 wrapRGB;\n#endif",
    lights_lambert_vertex: "vLightFront = vec3( 0.0 );\n#ifdef DOUBLE_SIDED\n\tvLightBack = vec3( 0.0 );\n#endif\ntransformedNormal = normalize( transformedNormal );\n#if MAX_DIR_LIGHTS > 0\nfor( int i = 0; i < MAX_DIR_LIGHTS; i ++ ) {\n\tvec4 lDirection = viewMatrix * vec4( directionalLightDirection[ i ], 0.0 );\n\tvec3 dirVector = normalize( lDirection.xyz );\n\tfloat dotProduct = dot( transformedNormal, dirVector );\n\tvec3 directionalLightWeighting = vec3( max( dotProduct, 0.0 ) );\n\t#ifdef DOUBLE_SIDED\n\t\tvec3 directionalLightWeightingBack = vec3( max( -dotProduct, 0.0 ) );\n\t\t#ifdef WRAP_AROUND\n\t\t\tvec3 directionalLightWeightingHalfBack = vec3( max( -0.5 * dotProduct + 0.5, 0.0 ) );\n\t\t#endif\n\t#endif\n\t#ifdef WRAP_AROUND\n\t\tvec3 directionalLightWeightingHalf = vec3( max( 0.5 * dotProduct + 0.5, 0.0 ) );\n\t\tdirectionalLightWeighting = mix( directionalLightWeighting, directionalLightWeightingHalf, wrapRGB );\n\t\t#ifdef DOUBLE_SIDED\n\t\t\tdirectionalLightWeightingBack = mix( directionalLightWeightingBack, directionalLightWeightingHalfBack, wrapRGB );\n\t\t#endif\n\t#endif\n\tvLightFront += directionalLightColor[ i ] * directionalLightWeighting;\n\t#ifdef DOUBLE_SIDED\n\t\tvLightBack += directionalLightColor[ i ] * directionalLightWeightingBack;\n\t#endif\n}\n#endif\n#if MAX_POINT_LIGHTS > 0\n\tfor( int i = 0; i < MAX_POINT_LIGHTS; i ++ ) {\n\t\tvec4 lPosition = viewMatrix * vec4( pointLightPosition[ i ], 1.0 );\n\t\tvec3 lVector = lPosition.xyz - mvPosition.xyz;\n\t\tfloat lDistance = 1.0;\n\t\tif ( pointLightDistance[ i ] > 0.0 )\n\t\t\tlDistance = 1.0 - min( ( length( lVector ) / pointLightDistance[ i ] ), 1.0 );\n\t\tlVector = normalize( lVector );\n\t\tfloat dotProduct = dot( transformedNormal, lVector );\n\t\tvec3 pointLightWeighting = vec3( max( dotProduct, 0.0 ) );\n\t\t#ifdef DOUBLE_SIDED\n\t\t\tvec3 pointLightWeightingBack = vec3( max( -dotProduct, 0.0 ) );\n\t\t\t#ifdef WRAP_AROUND\n\t\t\t\tvec3 pointLightWeightingHalfBack = vec3( max( -0.5 * dotProduct + 0.5, 0.0 ) );\n\t\t\t#endif\n\t\t#endif\n\t\t#ifdef WRAP_AROUND\n\t\t\tvec3 pointLightWeightingHalf = vec3( max( 0.5 * dotProduct + 0.5, 0.0 ) );\n\t\t\tpointLightWeighting = mix( pointLightWeighting, pointLightWeightingHalf, wrapRGB );\n\t\t\t#ifdef DOUBLE_SIDED\n\t\t\t\tpointLightWeightingBack = mix( pointLightWeightingBack, pointLightWeightingHalfBack, wrapRGB );\n\t\t\t#endif\n\t\t#endif\n\t\tvLightFront += pointLightColor[ i ] * pointLightWeighting * lDistance;\n\t\t#ifdef DOUBLE_SIDED\n\t\t\tvLightBack += pointLightColor[ i ] * pointLightWeightingBack * lDistance;\n\t\t#endif\n\t}\n#endif\n#if MAX_SPOT_LIGHTS > 0\n\tfor( int i = 0; i < MAX_SPOT_LIGHTS; i ++ ) {\n\t\tvec4 lPosition = viewMatrix * vec4( spotLightPosition[ i ], 1.0 );\n\t\tvec3 lVector = lPosition.xyz - mvPosition.xyz;\n\t\tfloat spotEffect = dot( spotLightDirection[ i ], normalize( spotLightPosition[ i ] - worldPosition.xyz ) );\n\t\tif ( spotEffect > spotLightAngleCos[ i ] ) {\n\t\t\tspotEffect = max( pow( max( spotEffect, 0.0 ), spotLightExponent[ i ] ), 0.0 );\n\t\t\tfloat lDistance = 1.0;\n\t\t\tif ( spotLightDistance[ i ] > 0.0 )\n\t\t\t\tlDistance = 1.0 - min( ( length( lVector ) / spotLightDistance[ i ] ), 1.0 );\n\t\t\tlVector = normalize( lVector );\n\t\t\tfloat dotProduct = dot( transformedNormal, lVector );\n\t\t\tvec3 spotLightWeighting = vec3( max( dotProduct, 0.0 ) );\n\t\t\t#ifdef DOUBLE_SIDED\n\t\t\t\tvec3 spotLightWeightingBack = vec3( max( -dotProduct, 0.0 ) );\n\t\t\t\t#ifdef WRAP_AROUND\n\t\t\t\t\tvec3 spotLightWeightingHalfBack = vec3( max( -0.5 * dotProduct + 0.5, 0.0 ) );\n\t\t\t\t#endif\n\t\t\t#endif\n\t\t\t#ifdef WRAP_AROUND\n\t\t\t\tvec3 spotLightWeightingHalf = vec3( max( 0.5 * dotProduct + 0.5, 0.0 ) );\n\t\t\t\tspotLightWeighting = mix( spotLightWeighting, spotLightWeightingHalf, wrapRGB );\n\t\t\t\t#ifdef DOUBLE_SIDED\n\t\t\t\t\tspotLightWeightingBack = mix( spotLightWeightingBack, spotLightWeightingHalfBack, wrapRGB );\n\t\t\t\t#endif\n\t\t\t#endif\n\t\t\tvLightFront += spotLightColor[ i ] * spotLightWeighting * lDistance * spotEffect;\n\t\t\t#ifdef DOUBLE_SIDED\n\t\t\t\tvLightBack += spotLightColor[ i ] * spotLightWeightingBack * lDistance * spotEffect;\n\t\t\t#endif\n\t\t}\n\t}\n#endif\n#if MAX_HEMI_LIGHTS > 0\n\tfor( int i = 0; i < MAX_HEMI_LIGHTS; i ++ ) {\n\t\tvec4 lDirection = viewMatrix * vec4( hemisphereLightDirection[ i ], 0.0 );\n\t\tvec3 lVector = normalize( lDirection.xyz );\n\t\tfloat dotProduct = dot( transformedNormal, lVector );\n\t\tfloat hemiDiffuseWeight = 0.5 * dotProduct + 0.5;\n\t\tfloat hemiDiffuseWeightBack = -0.5 * dotProduct + 0.5;\n\t\tvLightFront += mix( hemisphereLightGroundColor[ i ], hemisphereLightSkyColor[ i ], hemiDiffuseWeight );\n\t\t#ifdef DOUBLE_SIDED\n\t\t\tvLightBack += mix( hemisphereLightGroundColor[ i ], hemisphereLightSkyColor[ i ], hemiDiffuseWeightBack );\n\t\t#endif\n\t}\n#endif\nvLightFront = vLightFront * diffuse + ambient * ambientLightColor + emissive;\n#ifdef DOUBLE_SIDED\n\tvLightBack = vLightBack * diffuse + ambient * ambientLightColor + emissive;\n#endif",
    lights_phong_pars_vertex: "#if MAX_SPOT_LIGHTS > 0 || defined( USE_BUMPMAP ) || defined( USE_ENVMAP )\n\tvarying vec3 vWorldPosition;\n#endif",
    lights_phong_vertex: "#if MAX_SPOT_LIGHTS > 0 || defined( USE_BUMPMAP ) || defined( USE_ENVMAP )\n\tvWorldPosition = worldPosition.xyz;\n#endif",
    lights_phong_pars_fragment: "uniform vec3 ambientLightColor;\n#if MAX_DIR_LIGHTS > 0\n\tuniform vec3 directionalLightColor[ MAX_DIR_LIGHTS ];\n\tuniform vec3 directionalLightDirection[ MAX_DIR_LIGHTS ];\n#endif\n#if MAX_HEMI_LIGHTS > 0\n\tuniform vec3 hemisphereLightSkyColor[ MAX_HEMI_LIGHTS ];\n\tuniform vec3 hemisphereLightGroundColor[ MAX_HEMI_LIGHTS ];\n\tuniform vec3 hemisphereLightDirection[ MAX_HEMI_LIGHTS ];\n#endif\n#if MAX_POINT_LIGHTS > 0\n\tuniform vec3 pointLightColor[ MAX_POINT_LIGHTS ];\n\tuniform vec3 pointLightPosition[ MAX_POINT_LIGHTS ];\n\tuniform float pointLightDistance[ MAX_POINT_LIGHTS ];\n#endif\n#if MAX_SPOT_LIGHTS > 0\n\tuniform vec3 spotLightColor[ MAX_SPOT_LIGHTS ];\n\tuniform vec3 spotLightPosition[ MAX_SPOT_LIGHTS ];\n\tuniform vec3 spotLightDirection[ MAX_SPOT_LIGHTS ];\n\tuniform float spotLightAngleCos[ MAX_SPOT_LIGHTS ];\n\tuniform float spotLightExponent[ MAX_SPOT_LIGHTS ];\n\tuniform float spotLightDistance[ MAX_SPOT_LIGHTS ];\n#endif\n#if MAX_SPOT_LIGHTS > 0 || defined( USE_BUMPMAP ) || defined( USE_ENVMAP )\n\tvarying vec3 vWorldPosition;\n#endif\n#ifdef WRAP_AROUND\n\tuniform vec3 wrapRGB;\n#endif\nvarying vec3 vViewPosition;\nvarying vec3 vNormal;",
    lights_phong_fragment: "vec3 normal = normalize( vNormal );\nvec3 viewPosition = normalize( vViewPosition );\n#ifdef DOUBLE_SIDED\n\tnormal = normal * ( -1.0 + 2.0 * float( gl_FrontFacing ) );\n#endif\n#ifdef USE_NORMALMAP\n\tnormal = perturbNormal2Arb( -vViewPosition, normal );\n#elif defined( USE_BUMPMAP )\n\tnormal = perturbNormalArb( -vViewPosition, normal, dHdxy_fwd() );\n#endif\n#if MAX_POINT_LIGHTS > 0\n\tvec3 pointDiffuse = vec3( 0.0 );\n\tvec3 pointSpecular = vec3( 0.0 );\n\tfor ( int i = 0; i < MAX_POINT_LIGHTS; i ++ ) {\n\t\tvec4 lPosition = viewMatrix * vec4( pointLightPosition[ i ], 1.0 );\n\t\tvec3 lVector = lPosition.xyz + vViewPosition.xyz;\n\t\tfloat lDistance = 1.0;\n\t\tif ( pointLightDistance[ i ] > 0.0 )\n\t\t\tlDistance = 1.0 - min( ( length( lVector ) / pointLightDistance[ i ] ), 1.0 );\n\t\tlVector = normalize( lVector );\n\t\tfloat dotProduct = dot( normal, lVector );\n\t\t#ifdef WRAP_AROUND\n\t\t\tfloat pointDiffuseWeightFull = max( dotProduct, 0.0 );\n\t\t\tfloat pointDiffuseWeightHalf = max( 0.5 * dotProduct + 0.5, 0.0 );\n\t\t\tvec3 pointDiffuseWeight = mix( vec3( pointDiffuseWeightFull ), vec3( pointDiffuseWeightHalf ), wrapRGB );\n\t\t#else\n\t\t\tfloat pointDiffuseWeight = max( dotProduct, 0.0 );\n\t\t#endif\n\t\tpointDiffuse += diffuse * pointLightColor[ i ] * pointDiffuseWeight * lDistance;\n\t\tvec3 pointHalfVector = normalize( lVector + viewPosition );\n\t\tfloat pointDotNormalHalf = max( dot( normal, pointHalfVector ), 0.0 );\n\t\tfloat pointSpecularWeight = specularStrength * max( pow( pointDotNormalHalf, shininess ), 0.0 );\n\t\tfloat specularNormalization = ( shininess + 2.0 ) / 8.0;\n\t\tvec3 schlick = specular + vec3( 1.0 - specular ) * pow( max( 1.0 - dot( lVector, pointHalfVector ), 0.0 ), 5.0 );\n\t\tpointSpecular += schlick * pointLightColor[ i ] * pointSpecularWeight * pointDiffuseWeight * lDistance * specularNormalization;\n\t}\n#endif\n#if MAX_SPOT_LIGHTS > 0\n\tvec3 spotDiffuse = vec3( 0.0 );\n\tvec3 spotSpecular = vec3( 0.0 );\n\tfor ( int i = 0; i < MAX_SPOT_LIGHTS; i ++ ) {\n\t\tvec4 lPosition = viewMatrix * vec4( spotLightPosition[ i ], 1.0 );\n\t\tvec3 lVector = lPosition.xyz + vViewPosition.xyz;\n\t\tfloat lDistance = 1.0;\n\t\tif ( spotLightDistance[ i ] > 0.0 )\n\t\t\tlDistance = 1.0 - min( ( length( lVector ) / spotLightDistance[ i ] ), 1.0 );\n\t\tlVector = normalize( lVector );\n\t\tfloat spotEffect = dot( spotLightDirection[ i ], normalize( spotLightPosition[ i ] - vWorldPosition ) );\n\t\tif ( spotEffect > spotLightAngleCos[ i ] ) {\n\t\t\tspotEffect = max( pow( max( spotEffect, 0.0 ), spotLightExponent[ i ] ), 0.0 );\n\t\t\tfloat dotProduct = dot( normal, lVector );\n\t\t\t#ifdef WRAP_AROUND\n\t\t\t\tfloat spotDiffuseWeightFull = max( dotProduct, 0.0 );\n\t\t\t\tfloat spotDiffuseWeightHalf = max( 0.5 * dotProduct + 0.5, 0.0 );\n\t\t\t\tvec3 spotDiffuseWeight = mix( vec3( spotDiffuseWeightFull ), vec3( spotDiffuseWeightHalf ), wrapRGB );\n\t\t\t#else\n\t\t\t\tfloat spotDiffuseWeight = max( dotProduct, 0.0 );\n\t\t\t#endif\n\t\t\tspotDiffuse += diffuse * spotLightColor[ i ] * spotDiffuseWeight * lDistance * spotEffect;\n\t\t\tvec3 spotHalfVector = normalize( lVector + viewPosition );\n\t\t\tfloat spotDotNormalHalf = max( dot( normal, spotHalfVector ), 0.0 );\n\t\t\tfloat spotSpecularWeight = specularStrength * max( pow( spotDotNormalHalf, shininess ), 0.0 );\n\t\t\tfloat specularNormalization = ( shininess + 2.0 ) / 8.0;\n\t\t\tvec3 schlick = specular + vec3( 1.0 - specular ) * pow( max( 1.0 - dot( lVector, spotHalfVector ), 0.0 ), 5.0 );\n\t\t\tspotSpecular += schlick * spotLightColor[ i ] * spotSpecularWeight * spotDiffuseWeight * lDistance * specularNormalization * spotEffect;\n\t\t}\n\t}\n#endif\n#if MAX_DIR_LIGHTS > 0\n\tvec3 dirDiffuse = vec3( 0.0 );\n\tvec3 dirSpecular = vec3( 0.0 );\n\tfor( int i = 0; i < MAX_DIR_LIGHTS; i ++ ) {\n\t\tvec4 lDirection = viewMatrix * vec4( directionalLightDirection[ i ], 0.0 );\n\t\tvec3 dirVector = normalize( lDirection.xyz );\n\t\tfloat dotProduct = dot( normal, dirVector );\n\t\t#ifdef WRAP_AROUND\n\t\t\tfloat dirDiffuseWeightFull = max( dotProduct, 0.0 );\n\t\t\tfloat dirDiffuseWeightHalf = max( 0.5 * dotProduct + 0.5, 0.0 );\n\t\t\tvec3 dirDiffuseWeight = mix( vec3( dirDiffuseWeightFull ), vec3( dirDiffuseWeightHalf ), wrapRGB );\n\t\t#else\n\t\t\tfloat dirDiffuseWeight = max( dotProduct, 0.0 );\n\t\t#endif\n\t\tdirDiffuse += diffuse * directionalLightColor[ i ] * dirDiffuseWeight;\n\t\tvec3 dirHalfVector = normalize( dirVector + viewPosition );\n\t\tfloat dirDotNormalHalf = max( dot( normal, dirHalfVector ), 0.0 );\n\t\tfloat dirSpecularWeight = specularStrength * max( pow( dirDotNormalHalf, shininess ), 0.0 );\n\t\tfloat specularNormalization = ( shininess + 2.0 ) / 8.0;\n\t\tvec3 schlick = specular + vec3( 1.0 - specular ) * pow( max( 1.0 - dot( dirVector, dirHalfVector ), 0.0 ), 5.0 );\n\t\tdirSpecular += schlick * directionalLightColor[ i ] * dirSpecularWeight * dirDiffuseWeight * specularNormalization;\n\t}\n#endif\n#if MAX_HEMI_LIGHTS > 0\n\tvec3 hemiDiffuse = vec3( 0.0 );\n\tvec3 hemiSpecular = vec3( 0.0 );\n\tfor( int i = 0; i < MAX_HEMI_LIGHTS; i ++ ) {\n\t\tvec4 lDirection = viewMatrix * vec4( hemisphereLightDirection[ i ], 0.0 );\n\t\tvec3 lVector = normalize( lDirection.xyz );\n\t\tfloat dotProduct = dot( normal, lVector );\n\t\tfloat hemiDiffuseWeight = 0.5 * dotProduct + 0.5;\n\t\tvec3 hemiColor = mix( hemisphereLightGroundColor[ i ], hemisphereLightSkyColor[ i ], hemiDiffuseWeight );\n\t\themiDiffuse += diffuse * hemiColor;\n\t\tvec3 hemiHalfVectorSky = normalize( lVector + viewPosition );\n\t\tfloat hemiDotNormalHalfSky = 0.5 * dot( normal, hemiHalfVectorSky ) + 0.5;\n\t\tfloat hemiSpecularWeightSky = specularStrength * max( pow( max( hemiDotNormalHalfSky, 0.0 ), shininess ), 0.0 );\n\t\tvec3 lVectorGround = -lVector;\n\t\tvec3 hemiHalfVectorGround = normalize( lVectorGround + viewPosition );\n\t\tfloat hemiDotNormalHalfGround = 0.5 * dot( normal, hemiHalfVectorGround ) + 0.5;\n\t\tfloat hemiSpecularWeightGround = specularStrength * max( pow( max( hemiDotNormalHalfGround, 0.0 ), shininess ), 0.0 );\n\t\tfloat dotProductGround = dot( normal, lVectorGround );\n\t\tfloat specularNormalization = ( shininess + 2.0 ) / 8.0;\n\t\tvec3 schlickSky = specular + vec3( 1.0 - specular ) * pow( max( 1.0 - dot( lVector, hemiHalfVectorSky ), 0.0 ), 5.0 );\n\t\tvec3 schlickGround = specular + vec3( 1.0 - specular ) * pow( max( 1.0 - dot( lVectorGround, hemiHalfVectorGround ), 0.0 ), 5.0 );\n\t\themiSpecular += hemiColor * specularNormalization * ( schlickSky * hemiSpecularWeightSky * max( dotProduct, 0.0 ) + schlickGround * hemiSpecularWeightGround * max( dotProductGround, 0.0 ) );\n\t}\n#endif\nvec3 totalDiffuse = vec3( 0.0 );\nvec3 totalSpecular = vec3( 0.0 );\n#if MAX_DIR_LIGHTS > 0\n\ttotalDiffuse += dirDiffuse;\n\ttotalSpecular += dirSpecular;\n#endif\n#if MAX_HEMI_LIGHTS > 0\n\ttotalDiffuse += hemiDiffuse;\n\ttotalSpecular += hemiSpecular;\n#endif\n#if MAX_POINT_LIGHTS > 0\n\ttotalDiffuse += pointDiffuse;\n\ttotalSpecular += pointSpecular;\n#endif\n#if MAX_SPOT_LIGHTS > 0\n\ttotalDiffuse += spotDiffuse;\n\ttotalSpecular += spotSpecular;\n#endif\n#ifdef METAL\n\tgl_FragColor.xyz = gl_FragColor.xyz * ( emissive + totalDiffuse + ambientLightColor * ambient + totalSpecular );\n#else\n\tgl_FragColor.xyz = gl_FragColor.xyz * ( emissive + totalDiffuse + ambientLightColor * ambient ) + totalSpecular;\n#endif",
    color_pars_fragment: "#ifdef USE_COLOR\n\tvarying vec3 vColor;\n#endif",
    color_fragment: "#ifdef USE_COLOR\n\tgl_FragColor = gl_FragColor * vec4( vColor, 1.0 );\n#endif",
    color_pars_vertex: "#ifdef USE_COLOR\n\tvarying vec3 vColor;\n#endif",
    color_vertex: "#ifdef USE_COLOR\n\t#ifdef GAMMA_INPUT\n\t\tvColor = color * color;\n\t#else\n\t\tvColor = color;\n\t#endif\n#endif",
    skinning_pars_vertex: "#ifdef USE_SKINNING\n\t#ifdef BONE_TEXTURE\n\t\tuniform sampler2D boneTexture;\n\t\tuniform int boneTextureWidth;\n\t\tuniform int boneTextureHeight;\n\t\tmat4 getBoneMatrix( const in float i ) {\n\t\t\tfloat j = i * 4.0;\n\t\t\tfloat x = mod( j, float( boneTextureWidth ) );\n\t\t\tfloat y = floor( j / float( boneTextureWidth ) );\n\t\t\tfloat dx = 1.0 / float( boneTextureWidth );\n\t\t\tfloat dy = 1.0 / float( boneTextureHeight );\n\t\t\ty = dy * ( y + 0.5 );\n\t\t\tvec4 v1 = texture2D( boneTexture, vec2( dx * ( x + 0.5 ), y ) );\n\t\t\tvec4 v2 = texture2D( boneTexture, vec2( dx * ( x + 1.5 ), y ) );\n\t\t\tvec4 v3 = texture2D( boneTexture, vec2( dx * ( x + 2.5 ), y ) );\n\t\t\tvec4 v4 = texture2D( boneTexture, vec2( dx * ( x + 3.5 ), y ) );\n\t\t\tmat4 bone = mat4( v1, v2, v3, v4 );\n\t\t\treturn bone;\n\t\t}\n\t#else\n\t\tuniform mat4 boneGlobalMatrices[ MAX_BONES ];\n\t\tmat4 getBoneMatrix( const in float i ) {\n\t\t\tmat4 bone = boneGlobalMatrices[ int(i) ];\n\t\t\treturn bone;\n\t\t}\n\t#endif\n#endif",
    skinbase_vertex: "#ifdef USE_SKINNING\n\tmat4 boneMatX = getBoneMatrix( skinIndex.x );\n\tmat4 boneMatY = getBoneMatrix( skinIndex.y );\n\tmat4 boneMatZ = getBoneMatrix( skinIndex.z );\n\tmat4 boneMatW = getBoneMatrix( skinIndex.w );\n#endif",
    skinning_vertex: "#ifdef USE_SKINNING\n\t#ifdef USE_MORPHTARGETS\n\tvec4 skinVertex = vec4( morphed, 1.0 );\n\t#else\n\tvec4 skinVertex = vec4( position, 1.0 );\n\t#endif\n\tvec4 skinned = vec4( 0.0 );\n\tskinned += boneMatX * skinVertex * skinWeight.x;\n\tskinned += boneMatY * skinVertex * skinWeight.y;\n\tskinned += boneMatZ * skinVertex * skinWeight.z;\n\tskinned += boneMatW * skinVertex * skinWeight.w;\n#endif",
    morphtarget_pars_vertex: "#ifdef USE_MORPHTARGETS\n\t#ifndef USE_MORPHNORMALS\n\tuniform float morphTargetInfluences[ 8 ];\n\t#else\n\tuniform float morphTargetInfluences[ 4 ];\n\t#endif\n#endif",
    morphtarget_vertex: "#ifdef USE_MORPHTARGETS\n\tvec3 morphed = vec3( 0.0 );\n\tmorphed += ( morphTarget0 - position ) * morphTargetInfluences[ 0 ];\n\tmorphed += ( morphTarget1 - position ) * morphTargetInfluences[ 1 ];\n\tmorphed += ( morphTarget2 - position ) * morphTargetInfluences[ 2 ];\n\tmorphed += ( morphTarget3 - position ) * morphTargetInfluences[ 3 ];\n\t#ifndef USE_MORPHNORMALS\n\tmorphed += ( morphTarget4 - position ) * morphTargetInfluences[ 4 ];\n\tmorphed += ( morphTarget5 - position ) * morphTargetInfluences[ 5 ];\n\tmorphed += ( morphTarget6 - position ) * morphTargetInfluences[ 6 ];\n\tmorphed += ( morphTarget7 - position ) * morphTargetInfluences[ 7 ];\n\t#endif\n\tmorphed += position;\n#endif",
    default_vertex: "vec4 mvPosition;\n#ifdef USE_SKINNING\n\tmvPosition = modelViewMatrix * skinned;\n#endif\n#if !defined( USE_SKINNING ) && defined( USE_MORPHTARGETS )\n\tmvPosition = modelViewMatrix * vec4( morphed, 1.0 );\n#endif\n#if !defined( USE_SKINNING ) && ! defined( USE_MORPHTARGETS )\n\tmvPosition = modelViewMatrix * vec4( position, 1.0 );\n#endif\ngl_Position = projectionMatrix * mvPosition;",
    morphnormal_vertex: "#ifdef USE_MORPHNORMALS\n\tvec3 morphedNormal = vec3( 0.0 );\n\tmorphedNormal += ( morphNormal0 - normal ) * morphTargetInfluences[ 0 ];\n\tmorphedNormal += ( morphNormal1 - normal ) * morphTargetInfluences[ 1 ];\n\tmorphedNormal += ( morphNormal2 - normal ) * morphTargetInfluences[ 2 ];\n\tmorphedNormal += ( morphNormal3 - normal ) * morphTargetInfluences[ 3 ];\n\tmorphedNormal += normal;\n#endif",
    skinnormal_vertex: "#ifdef USE_SKINNING\n\tmat4 skinMatrix = mat4( 0.0 );\n\tskinMatrix += skinWeight.x * boneMatX;\n\tskinMatrix += skinWeight.y * boneMatY;\n\tskinMatrix += skinWeight.z * boneMatZ;\n\tskinMatrix += skinWeight.w * boneMatW;\n\t#ifdef USE_MORPHNORMALS\n\tvec4 skinnedNormal = skinMatrix * vec4( morphedNormal, 0.0 );\n\t#else\n\tvec4 skinnedNormal = skinMatrix * vec4( normal, 0.0 );\n\t#endif\n#endif",
    defaultnormal_vertex: "vec3 objectNormal;\n#ifdef USE_SKINNING\n\tobjectNormal = skinnedNormal.xyz;\n#endif\n#if !defined( USE_SKINNING ) && defined( USE_MORPHNORMALS )\n\tobjectNormal = morphedNormal;\n#endif\n#if !defined( USE_SKINNING ) && ! defined( USE_MORPHNORMALS )\n\tobjectNormal = normal;\n#endif\n#ifdef FLIP_SIDED\n\tobjectNormal = -objectNormal;\n#endif\nvec3 transformedNormal = normalMatrix * objectNormal;",
    shadowmap_pars_fragment: "#ifdef USE_SHADOWMAP\n\tuniform sampler2D shadowMap[ MAX_SHADOWS ];\n\tuniform vec2 shadowMapSize[ MAX_SHADOWS ];\n\tuniform float shadowDarkness[ MAX_SHADOWS ];\n\tuniform float shadowBias[ MAX_SHADOWS ];\n\tvarying vec4 vShadowCoord[ MAX_SHADOWS ];\n\tfloat unpackDepth( const in vec4 rgba_depth ) {\n\t\tconst vec4 bit_shift = vec4( 1.0 / ( 256.0 * 256.0 * 256.0 ), 1.0 / ( 256.0 * 256.0 ), 1.0 / 256.0, 1.0 );\n\t\tfloat depth = dot( rgba_depth, bit_shift );\n\t\treturn depth;\n\t}\n#endif",
    shadowmap_fragment: "#ifdef USE_SHADOWMAP\n\t#ifdef SHADOWMAP_DEBUG\n\t\tvec3 frustumColors[3];\n\t\tfrustumColors[0] = vec3( 1.0, 0.5, 0.0 );\n\t\tfrustumColors[1] = vec3( 0.0, 1.0, 0.8 );\n\t\tfrustumColors[2] = vec3( 0.0, 0.5, 1.0 );\n\t#endif\n\t#ifdef SHADOWMAP_CASCADE\n\t\tint inFrustumCount = 0;\n\t#endif\n\tfloat fDepth;\n\tvec3 shadowColor = vec3( 1.0 );\n\tfor( int i = 0; i < MAX_SHADOWS; i ++ ) {\n\t\tvec3 shadowCoord = vShadowCoord[ i ].xyz / vShadowCoord[ i ].w;\n\t\tbvec4 inFrustumVec = bvec4 ( shadowCoord.x >= 0.0, shadowCoord.x <= 1.0, shadowCoord.y >= 0.0, shadowCoord.y <= 1.0 );\n\t\tbool inFrustum = all( inFrustumVec );\n\t\t#ifdef SHADOWMAP_CASCADE\n\t\t\tinFrustumCount += int( inFrustum );\n\t\t\tbvec3 frustumTestVec = bvec3( inFrustum, inFrustumCount == 1, shadowCoord.z <= 1.0 );\n\t\t#else\n\t\t\tbvec2 frustumTestVec = bvec2( inFrustum, shadowCoord.z <= 1.0 );\n\t\t#endif\n\t\tbool frustumTest = all( frustumTestVec );\n\t\tif ( frustumTest ) {\n\t\t\tshadowCoord.z += shadowBias[ i ];\n\t\t\t#if defined( SHADOWMAP_TYPE_PCF )\n\t\t\t\tfloat shadow = 0.0;\n\t\t\t\tconst float shadowDelta = 1.0 / 9.0;\n\t\t\t\tfloat xPixelOffset = 1.0 / shadowMapSize[ i ].x;\n\t\t\t\tfloat yPixelOffset = 1.0 / shadowMapSize[ i ].y;\n\t\t\t\tfloat dx0 = -1.25 * xPixelOffset;\n\t\t\t\tfloat dy0 = -1.25 * yPixelOffset;\n\t\t\t\tfloat dx1 = 1.25 * xPixelOffset;\n\t\t\t\tfloat dy1 = 1.25 * yPixelOffset;\n\t\t\t\tfDepth = unpackDepth( texture2D( shadowMap[ i ], shadowCoord.xy + vec2( dx0, dy0 ) ) );\n\t\t\t\tif ( fDepth < shadowCoord.z ) shadow += shadowDelta;\n\t\t\t\tfDepth = unpackDepth( texture2D( shadowMap[ i ], shadowCoord.xy + vec2( 0.0, dy0 ) ) );\n\t\t\t\tif ( fDepth < shadowCoord.z ) shadow += shadowDelta;\n\t\t\t\tfDepth = unpackDepth( texture2D( shadowMap[ i ], shadowCoord.xy + vec2( dx1, dy0 ) ) );\n\t\t\t\tif ( fDepth < shadowCoord.z ) shadow += shadowDelta;\n\t\t\t\tfDepth = unpackDepth( texture2D( shadowMap[ i ], shadowCoord.xy + vec2( dx0, 0.0 ) ) );\n\t\t\t\tif ( fDepth < shadowCoord.z ) shadow += shadowDelta;\n\t\t\t\tfDepth = unpackDepth( texture2D( shadowMap[ i ], shadowCoord.xy ) );\n\t\t\t\tif ( fDepth < shadowCoord.z ) shadow += shadowDelta;\n\t\t\t\tfDepth = unpackDepth( texture2D( shadowMap[ i ], shadowCoord.xy + vec2( dx1, 0.0 ) ) );\n\t\t\t\tif ( fDepth < shadowCoord.z ) shadow += shadowDelta;\n\t\t\t\tfDepth = unpackDepth( texture2D( shadowMap[ i ], shadowCoord.xy + vec2( dx0, dy1 ) ) );\n\t\t\t\tif ( fDepth < shadowCoord.z ) shadow += shadowDelta;\n\t\t\t\tfDepth = unpackDepth( texture2D( shadowMap[ i ], shadowCoord.xy + vec2( 0.0, dy1 ) ) );\n\t\t\t\tif ( fDepth < shadowCoord.z ) shadow += shadowDelta;\n\t\t\t\tfDepth = unpackDepth( texture2D( shadowMap[ i ], shadowCoord.xy + vec2( dx1, dy1 ) ) );\n\t\t\t\tif ( fDepth < shadowCoord.z ) shadow += shadowDelta;\n\t\t\t\tshadowColor = shadowColor * vec3( ( 1.0 - shadowDarkness[ i ] * shadow ) );\n\t\t\t#elif defined( SHADOWMAP_TYPE_PCF_SOFT )\n\t\t\t\tfloat shadow = 0.0;\n\t\t\t\tfloat xPixelOffset = 1.0 / shadowMapSize[ i ].x;\n\t\t\t\tfloat yPixelOffset = 1.0 / shadowMapSize[ i ].y;\n\t\t\t\tfloat dx0 = -1.0 * xPixelOffset;\n\t\t\t\tfloat dy0 = -1.0 * yPixelOffset;\n\t\t\t\tfloat dx1 = 1.0 * xPixelOffset;\n\t\t\t\tfloat dy1 = 1.0 * yPixelOffset;\n\t\t\t\tmat3 shadowKernel;\n\t\t\t\tmat3 depthKernel;\n\t\t\t\tdepthKernel[0][0] = unpackDepth( texture2D( shadowMap[ i ], shadowCoord.xy + vec2( dx0, dy0 ) ) );\n\t\t\t\tdepthKernel[0][1] = unpackDepth( texture2D( shadowMap[ i ], shadowCoord.xy + vec2( dx0, 0.0 ) ) );\n\t\t\t\tdepthKernel[0][2] = unpackDepth( texture2D( shadowMap[ i ], shadowCoord.xy + vec2( dx0, dy1 ) ) );\n\t\t\t\tdepthKernel[1][0] = unpackDepth( texture2D( shadowMap[ i ], shadowCoord.xy + vec2( 0.0, dy0 ) ) );\n\t\t\t\tdepthKernel[1][1] = unpackDepth( texture2D( shadowMap[ i ], shadowCoord.xy ) );\n\t\t\t\tdepthKernel[1][2] = unpackDepth( texture2D( shadowMap[ i ], shadowCoord.xy + vec2( 0.0, dy1 ) ) );\n\t\t\t\tdepthKernel[2][0] = unpackDepth( texture2D( shadowMap[ i ], shadowCoord.xy + vec2( dx1, dy0 ) ) );\n\t\t\t\tdepthKernel[2][1] = unpackDepth( texture2D( shadowMap[ i ], shadowCoord.xy + vec2( dx1, 0.0 ) ) );\n\t\t\t\tdepthKernel[2][2] = unpackDepth( texture2D( shadowMap[ i ], shadowCoord.xy + vec2( dx1, dy1 ) ) );\n\t\t\t\tvec3 shadowZ = vec3( shadowCoord.z );\n\t\t\t\tshadowKernel[0] = vec3(lessThan(depthKernel[0], shadowZ ));\n\t\t\t\tshadowKernel[0] *= vec3(0.25);\n\t\t\t\tshadowKernel[1] = vec3(lessThan(depthKernel[1], shadowZ ));\n\t\t\t\tshadowKernel[1] *= vec3(0.25);\n\t\t\t\tshadowKernel[2] = vec3(lessThan(depthKernel[2], shadowZ ));\n\t\t\t\tshadowKernel[2] *= vec3(0.25);\n\t\t\t\tvec2 fractionalCoord = 1.0 - fract( shadowCoord.xy * shadowMapSize[i].xy );\n\t\t\t\tshadowKernel[0] = mix( shadowKernel[1], shadowKernel[0], fractionalCoord.x );\n\t\t\t\tshadowKernel[1] = mix( shadowKernel[2], shadowKernel[1], fractionalCoord.x );\n\t\t\t\tvec4 shadowValues;\n\t\t\t\tshadowValues.x = mix( shadowKernel[0][1], shadowKernel[0][0], fractionalCoord.y );\n\t\t\t\tshadowValues.y = mix( shadowKernel[0][2], shadowKernel[0][1], fractionalCoord.y );\n\t\t\t\tshadowValues.z = mix( shadowKernel[1][1], shadowKernel[1][0], fractionalCoord.y );\n\t\t\t\tshadowValues.w = mix( shadowKernel[1][2], shadowKernel[1][1], fractionalCoord.y );\n\t\t\t\tshadow = dot( shadowValues, vec4( 1.0 ) );\n\t\t\t\tshadowColor = shadowColor * vec3( ( 1.0 - shadowDarkness[ i ] * shadow ) );\n\t\t\t#else\n\t\t\t\tvec4 rgbaDepth = texture2D( shadowMap[ i ], shadowCoord.xy );\n\t\t\t\tfloat fDepth = unpackDepth( rgbaDepth );\n\t\t\t\tif ( fDepth < shadowCoord.z )\n\t\t\t\t\tshadowColor = shadowColor * vec3( 1.0 - shadowDarkness[ i ] );\n\t\t\t#endif\n\t\t}\n\t\t#ifdef SHADOWMAP_DEBUG\n\t\t\t#ifdef SHADOWMAP_CASCADE\n\t\t\t\tif ( inFrustum && inFrustumCount == 1 ) gl_FragColor.xyz *= frustumColors[ i ];\n\t\t\t#else\n\t\t\t\tif ( inFrustum ) gl_FragColor.xyz *= frustumColors[ i ];\n\t\t\t#endif\n\t\t#endif\n\t}\n\t#ifdef GAMMA_OUTPUT\n\t\tshadowColor *= shadowColor;\n\t#endif\n\tgl_FragColor.xyz = gl_FragColor.xyz * shadowColor;\n#endif",
    shadowmap_pars_vertex: "#ifdef USE_SHADOWMAP\n\tvarying vec4 vShadowCoord[ MAX_SHADOWS ];\n\tuniform mat4 shadowMatrix[ MAX_SHADOWS ];\n#endif",
    shadowmap_vertex: "#ifdef USE_SHADOWMAP\n\tfor( int i = 0; i < MAX_SHADOWS; i ++ ) {\n\t\tvShadowCoord[ i ] = shadowMatrix[ i ] * worldPosition;\n\t}\n#endif",
    alphatest_fragment: "#ifdef ALPHATEST\n\tif ( gl_FragColor.a < ALPHATEST ) discard;\n#endif",
    linear_to_gamma_fragment: "#ifdef GAMMA_OUTPUT\n\tgl_FragColor.xyz = sqrt( gl_FragColor.xyz );\n#endif",
    logdepthbuf_pars_vertex: "#ifdef USE_LOGDEPTHBUF\n\t#ifdef USE_LOGDEPTHBUF_EXT\n\t\tvarying float vFragDepth;\n\t#endif\n\tuniform float logDepthBufFC;\n#endif",
    logdepthbuf_vertex: "#ifdef USE_LOGDEPTHBUF\n\tgl_Position.z = log2(max(1e-6, gl_Position.w + 1.0)) * logDepthBufFC;\n\t#ifdef USE_LOGDEPTHBUF_EXT\n\t\tvFragDepth = 1.0 + gl_Position.w;\n#else\n\t\tgl_Position.z = (gl_Position.z - 1.0) * gl_Position.w;\n\t#endif\n#endif",
    logdepthbuf_pars_fragment: "#ifdef USE_LOGDEPTHBUF\n\tuniform float logDepthBufFC;\n\t#ifdef USE_LOGDEPTHBUF_EXT\n\t\t#extension GL_EXT_frag_depth : enable\n\t\tvarying float vFragDepth;\n\t#endif\n#endif",
    logdepthbuf_fragment: "#if defined(USE_LOGDEPTHBUF) && defined(USE_LOGDEPTHBUF_EXT)\n\tgl_FragDepthEXT = log2(vFragDepth) * logDepthBufFC * 0.5;\n#endif"
};
THREE.UniformsUtils = {
    merge: function(a) {
        var b, c, d, e = {};
        for (b = 0; b < a.length; b++)
            for (c in d = this.clone(a[b]), d) e[c] = d[c];
        return e
    },
    clone: function(a) {
        var b, c, d, e = {};
        for (b in a)
            for (c in e[b] = {}, a[b]) d = a[b][c], e[b][c] = d instanceof THREE.Color || d instanceof THREE.Vector2 || d instanceof THREE.Vector3 || d instanceof THREE.Vector4 || d instanceof THREE.Matrix4 || d instanceof THREE.Texture ? d.clone() : d instanceof Array ? d.slice() : d;
        return e
    }
};
THREE.UniformsLib = {
    common: {
        diffuse: {
            type: "c",
            value: new THREE.Color(15658734)
        },
        opacity: {
            type: "f",
            value: 1
        },
        map: {
            type: "t",
            value: null
        },
        offsetRepeat: {
            type: "v4",
            value: new THREE.Vector4(0, 0, 1, 1)
        },
        lightMap: {
            type: "t",
            value: null
        },
        specularMap: {
            type: "t",
            value: null
        },
        envMap: {
            type: "t",
            value: null
        },
        flipEnvMap: {
            type: "f",
            value: -1
        },
        useRefract: {
            type: "i",
            value: 0
        },
        reflectivity: {
            type: "f",
            value: 1
        },
        refractionRatio: {
            type: "f",
            value: 0.98
        },
        combine: {
            type: "i",
            value: 0
        },
        morphTargetInfluences: {
            type: "f",
            value: 0
        }
    },
    bump: {
        bumpMap: {
            type: "t",
            value: null
        },
        bumpScale: {
            type: "f",
            value: 1
        }
    },
    normalmap: {
        normalMap: {
            type: "t",
            value: null
        },
        normalScale: {
            type: "v2",
            value: new THREE.Vector2(1, 1)
        }
    },
    fog: {
        fogDensity: {
            type: "f",
            value: 2.5E-4
        },
        fogNear: {
            type: "f",
            value: 1
        },
        fogFar: {
            type: "f",
            value: 2E3
        },
        fogColor: {
            type: "c",
            value: new THREE.Color(16777215)
        }
    },
    lights: {
        ambientLightColor: {
            type: "fv",
            value: []
        },
        directionalLightDirection: {
            type: "fv",
            value: []
        },
        directionalLightColor: {
            type: "fv",
            value: []
        },
        hemisphereLightDirection: {
            type: "fv",
            value: []
        },
        hemisphereLightSkyColor: {
            type: "fv",
            value: []
        },
        hemisphereLightGroundColor: {
            type: "fv",
            value: []
        },
        pointLightColor: {
            type: "fv",
            value: []
        },
        pointLightPosition: {
            type: "fv",
            value: []
        },
        pointLightDistance: {
            type: "fv1",
            value: []
        },
        spotLightColor: {
            type: "fv",
            value: []
        },
        spotLightPosition: {
            type: "fv",
            value: []
        },
        spotLightDirection: {
            type: "fv",
            value: []
        },
        spotLightDistance: {
            type: "fv1",
            value: []
        },
        spotLightAngleCos: {
            type: "fv1",
            value: []
        },
        spotLightExponent: {
            type: "fv1",
            value: []
        }
    },
    particle: {
        psColor: {
            type: "c",
            value: new THREE.Color(15658734)
        },
        opacity: {
            type: "f",
            value: 1
        },
        size: {
            type: "f",
            value: 1
        },
        scale: {
            type: "f",
            value: 1
        },
        map: {
            type: "t",
            value: null
        },
        fogDensity: {
            type: "f",
            value: 2.5E-4
        },
        fogNear: {
            type: "f",
            value: 1
        },
        fogFar: {
            type: "f",
            value: 2E3
        },
        fogColor: {
            type: "c",
            value: new THREE.Color(16777215)
        }
    },
    shadowmap: {
        shadowMap: {
            type: "tv",
            value: []
        },
        shadowMapSize: {
            type: "v2v",
            value: []
        },
        shadowBias: {
            type: "fv1",
            value: []
        },
        shadowDarkness: {
            type: "fv1",
            value: []
        },
        shadowMatrix: {
            type: "m4v",
            value: []
        }
    }
};
THREE.ShaderLib = {
    basic: {
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.common, THREE.UniformsLib.fog, THREE.UniformsLib.shadowmap]),
        vertexShader: [THREE.ShaderChunk.map_pars_vertex, THREE.ShaderChunk.lightmap_pars_vertex, THREE.ShaderChunk.envmap_pars_vertex, THREE.ShaderChunk.color_pars_vertex, THREE.ShaderChunk.morphtarget_pars_vertex, THREE.ShaderChunk.skinning_pars_vertex, THREE.ShaderChunk.shadowmap_pars_vertex, THREE.ShaderChunk.logdepthbuf_pars_vertex, "void main() {", THREE.ShaderChunk.map_vertex,
            THREE.ShaderChunk.lightmap_vertex, THREE.ShaderChunk.color_vertex, THREE.ShaderChunk.skinbase_vertex, "\t#ifdef USE_ENVMAP", THREE.ShaderChunk.morphnormal_vertex, THREE.ShaderChunk.skinnormal_vertex, THREE.ShaderChunk.defaultnormal_vertex, "\t#endif", THREE.ShaderChunk.morphtarget_vertex, THREE.ShaderChunk.skinning_vertex, THREE.ShaderChunk.default_vertex, THREE.ShaderChunk.logdepthbuf_vertex, THREE.ShaderChunk.worldpos_vertex, THREE.ShaderChunk.envmap_vertex, THREE.ShaderChunk.shadowmap_vertex, "}"
        ].join("\n"),
        fragmentShader: ["uniform vec3 diffuse;\nuniform float opacity;", THREE.ShaderChunk.color_pars_fragment, THREE.ShaderChunk.map_pars_fragment, THREE.ShaderChunk.lightmap_pars_fragment, THREE.ShaderChunk.envmap_pars_fragment, THREE.ShaderChunk.fog_pars_fragment, THREE.ShaderChunk.shadowmap_pars_fragment, THREE.ShaderChunk.specularmap_pars_fragment, THREE.ShaderChunk.logdepthbuf_pars_fragment, "void main() {\n\tgl_FragColor = vec4( diffuse, opacity );", THREE.ShaderChunk.logdepthbuf_fragment, THREE.ShaderChunk.map_fragment,
            THREE.ShaderChunk.alphatest_fragment, THREE.ShaderChunk.specularmap_fragment, THREE.ShaderChunk.lightmap_fragment, THREE.ShaderChunk.color_fragment, THREE.ShaderChunk.envmap_fragment, THREE.ShaderChunk.shadowmap_fragment, THREE.ShaderChunk.linear_to_gamma_fragment, THREE.ShaderChunk.fog_fragment, "}"
        ].join("\n")
    },
    lambert: {
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.common, THREE.UniformsLib.fog, THREE.UniformsLib.lights, THREE.UniformsLib.shadowmap, {
            ambient: {
                type: "c",
                value: new THREE.Color(16777215)
            },
            emissive: {
                type: "c",
                value: new THREE.Color(0)
            },
            wrapRGB: {
                type: "v3",
                value: new THREE.Vector3(1, 1, 1)
            }
        }]),
        vertexShader: ["#define LAMBERT\nvarying vec3 vLightFront;\n#ifdef DOUBLE_SIDED\n\tvarying vec3 vLightBack;\n#endif", THREE.ShaderChunk.map_pars_vertex, THREE.ShaderChunk.lightmap_pars_vertex, THREE.ShaderChunk.envmap_pars_vertex, THREE.ShaderChunk.lights_lambert_pars_vertex, THREE.ShaderChunk.color_pars_vertex, THREE.ShaderChunk.morphtarget_pars_vertex, THREE.ShaderChunk.skinning_pars_vertex, THREE.ShaderChunk.shadowmap_pars_vertex,
            THREE.ShaderChunk.logdepthbuf_pars_vertex, "void main() {", THREE.ShaderChunk.map_vertex, THREE.ShaderChunk.lightmap_vertex, THREE.ShaderChunk.color_vertex, THREE.ShaderChunk.morphnormal_vertex, THREE.ShaderChunk.skinbase_vertex, THREE.ShaderChunk.skinnormal_vertex, THREE.ShaderChunk.defaultnormal_vertex, THREE.ShaderChunk.morphtarget_vertex, THREE.ShaderChunk.skinning_vertex, THREE.ShaderChunk.default_vertex, THREE.ShaderChunk.logdepthbuf_vertex, THREE.ShaderChunk.worldpos_vertex, THREE.ShaderChunk.envmap_vertex,
            THREE.ShaderChunk.lights_lambert_vertex, THREE.ShaderChunk.shadowmap_vertex, "}"
        ].join("\n"),
        fragmentShader: ["uniform float opacity;\nvarying vec3 vLightFront;\n#ifdef DOUBLE_SIDED\n\tvarying vec3 vLightBack;\n#endif", THREE.ShaderChunk.color_pars_fragment, THREE.ShaderChunk.map_pars_fragment, THREE.ShaderChunk.lightmap_pars_fragment, THREE.ShaderChunk.envmap_pars_fragment, THREE.ShaderChunk.fog_pars_fragment, THREE.ShaderChunk.shadowmap_pars_fragment, THREE.ShaderChunk.specularmap_pars_fragment, THREE.ShaderChunk.logdepthbuf_pars_fragment,
            "void main() {\n\tgl_FragColor = vec4( vec3( 1.0 ), opacity );", THREE.ShaderChunk.logdepthbuf_fragment, THREE.ShaderChunk.map_fragment, THREE.ShaderChunk.alphatest_fragment, THREE.ShaderChunk.specularmap_fragment, "\t#ifdef DOUBLE_SIDED\n\t\tif ( gl_FrontFacing )\n\t\t\tgl_FragColor.xyz *= vLightFront;\n\t\telse\n\t\t\tgl_FragColor.xyz *= vLightBack;\n\t#else\n\t\tgl_FragColor.xyz *= vLightFront;\n\t#endif", THREE.ShaderChunk.lightmap_fragment, THREE.ShaderChunk.color_fragment, THREE.ShaderChunk.envmap_fragment,
            THREE.ShaderChunk.shadowmap_fragment, THREE.ShaderChunk.linear_to_gamma_fragment, THREE.ShaderChunk.fog_fragment, "}"
        ].join("\n")
    },
    phong: {
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.common, THREE.UniformsLib.bump, THREE.UniformsLib.normalmap, THREE.UniformsLib.fog, THREE.UniformsLib.lights, THREE.UniformsLib.shadowmap, {
            ambient: {
                type: "c",
                value: new THREE.Color(16777215)
            },
            emissive: {
                type: "c",
                value: new THREE.Color(0)
            },
            specular: {
                type: "c",
                value: new THREE.Color(1118481)
            },
            shininess: {
                type: "f",
                value: 30
            },
            wrapRGB: {
                type: "v3",
                value: new THREE.Vector3(1, 1, 1)
            }
        }]),
        vertexShader: ["#define PHONG\nvarying vec3 vViewPosition;\nvarying vec3 vNormal;", THREE.ShaderChunk.map_pars_vertex, THREE.ShaderChunk.lightmap_pars_vertex, THREE.ShaderChunk.envmap_pars_vertex, THREE.ShaderChunk.lights_phong_pars_vertex, THREE.ShaderChunk.color_pars_vertex, THREE.ShaderChunk.morphtarget_pars_vertex, THREE.ShaderChunk.skinning_pars_vertex, THREE.ShaderChunk.shadowmap_pars_vertex, THREE.ShaderChunk.logdepthbuf_pars_vertex, "void main() {", THREE.ShaderChunk.map_vertex,
            THREE.ShaderChunk.lightmap_vertex, THREE.ShaderChunk.color_vertex, THREE.ShaderChunk.morphnormal_vertex, THREE.ShaderChunk.skinbase_vertex, THREE.ShaderChunk.skinnormal_vertex, THREE.ShaderChunk.defaultnormal_vertex, "\tvNormal = normalize( transformedNormal );", THREE.ShaderChunk.morphtarget_vertex, THREE.ShaderChunk.skinning_vertex, THREE.ShaderChunk.default_vertex, THREE.ShaderChunk.logdepthbuf_vertex, "\tvViewPosition = -mvPosition.xyz;", THREE.ShaderChunk.worldpos_vertex, THREE.ShaderChunk.envmap_vertex,
            THREE.ShaderChunk.lights_phong_vertex, THREE.ShaderChunk.shadowmap_vertex, "}"
        ].join("\n"),
        fragmentShader: ["uniform vec3 diffuse;\nuniform float opacity;\nuniform vec3 ambient;\nuniform vec3 emissive;\nuniform vec3 specular;\nuniform float shininess;", THREE.ShaderChunk.color_pars_fragment, THREE.ShaderChunk.map_pars_fragment, THREE.ShaderChunk.lightmap_pars_fragment, THREE.ShaderChunk.envmap_pars_fragment, THREE.ShaderChunk.fog_pars_fragment, THREE.ShaderChunk.lights_phong_pars_fragment, THREE.ShaderChunk.shadowmap_pars_fragment,
            THREE.ShaderChunk.bumpmap_pars_fragment, THREE.ShaderChunk.normalmap_pars_fragment, THREE.ShaderChunk.specularmap_pars_fragment, THREE.ShaderChunk.logdepthbuf_pars_fragment, "void main() {\n\tgl_FragColor = vec4( vec3( 1.0 ), opacity );", THREE.ShaderChunk.logdepthbuf_fragment, THREE.ShaderChunk.map_fragment, THREE.ShaderChunk.alphatest_fragment, THREE.ShaderChunk.specularmap_fragment, THREE.ShaderChunk.lights_phong_fragment, THREE.ShaderChunk.lightmap_fragment, THREE.ShaderChunk.color_fragment, THREE.ShaderChunk.envmap_fragment,
            THREE.ShaderChunk.shadowmap_fragment, THREE.ShaderChunk.linear_to_gamma_fragment, THREE.ShaderChunk.fog_fragment, "}"
        ].join("\n")
    },
    particle_basic: {
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.particle, THREE.UniformsLib.shadowmap]),
        vertexShader: ["uniform float size;\nuniform float scale;", THREE.ShaderChunk.color_pars_vertex, THREE.ShaderChunk.shadowmap_pars_vertex, THREE.ShaderChunk.logdepthbuf_pars_vertex, "void main() {", THREE.ShaderChunk.color_vertex, "\tvec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );\n\t#ifdef USE_SIZEATTENUATION\n\t\tgl_PointSize = size * ( scale / length( mvPosition.xyz ) );\n\t#else\n\t\tgl_PointSize = size;\n\t#endif\n\tgl_Position = projectionMatrix * mvPosition;",
            THREE.ShaderChunk.logdepthbuf_vertex, THREE.ShaderChunk.worldpos_vertex, THREE.ShaderChunk.shadowmap_vertex, "}"
        ].join("\n"),
        fragmentShader: ["uniform vec3 psColor;\nuniform float opacity;", THREE.ShaderChunk.color_pars_fragment, THREE.ShaderChunk.map_particle_pars_fragment, THREE.ShaderChunk.fog_pars_fragment, THREE.ShaderChunk.shadowmap_pars_fragment, THREE.ShaderChunk.logdepthbuf_pars_fragment, "void main() {\n\tgl_FragColor = vec4( psColor, opacity );", THREE.ShaderChunk.logdepthbuf_fragment, THREE.ShaderChunk.map_particle_fragment,
            THREE.ShaderChunk.alphatest_fragment, THREE.ShaderChunk.color_fragment, THREE.ShaderChunk.shadowmap_fragment, THREE.ShaderChunk.fog_fragment, "}"
        ].join("\n")
    },
    dashed: {
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.common, THREE.UniformsLib.fog, {
            scale: {
                type: "f",
                value: 1
            },
            dashSize: {
                type: "f",
                value: 1
            },
            totalSize: {
                type: "f",
                value: 2
            }
        }]),
        vertexShader: ["uniform float scale;\nattribute float lineDistance;\nvarying float vLineDistance;", THREE.ShaderChunk.color_pars_vertex, THREE.ShaderChunk.logdepthbuf_pars_vertex,
            "void main() {", THREE.ShaderChunk.color_vertex, "\tvLineDistance = scale * lineDistance;\n\tvec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );\n\tgl_Position = projectionMatrix * mvPosition;", THREE.ShaderChunk.logdepthbuf_vertex, "}"
        ].join("\n"),
        fragmentShader: ["uniform vec3 diffuse;\nuniform float opacity;\nuniform float dashSize;\nuniform float totalSize;\nvarying float vLineDistance;", THREE.ShaderChunk.color_pars_fragment, THREE.ShaderChunk.fog_pars_fragment, THREE.ShaderChunk.logdepthbuf_pars_fragment,
            "void main() {\n\tif ( mod( vLineDistance, totalSize ) > dashSize ) {\n\t\tdiscard;\n\t}\n\tgl_FragColor = vec4( diffuse, opacity );", THREE.ShaderChunk.logdepthbuf_fragment, THREE.ShaderChunk.color_fragment, THREE.ShaderChunk.fog_fragment, "}"
        ].join("\n")
    },
    depth: {
        uniforms: {
            mNear: {
                type: "f",
                value: 1
            },
            mFar: {
                type: "f",
                value: 2E3
            },
            opacity: {
                type: "f",
                value: 1
            }
        },
        vertexShader: [THREE.ShaderChunk.morphtarget_pars_vertex, THREE.ShaderChunk.logdepthbuf_pars_vertex, "void main() {", THREE.ShaderChunk.morphtarget_vertex,
            THREE.ShaderChunk.default_vertex, THREE.ShaderChunk.logdepthbuf_vertex, "}"
        ].join("\n"),
        fragmentShader: ["uniform float mNear;\nuniform float mFar;\nuniform float opacity;", THREE.ShaderChunk.logdepthbuf_pars_fragment, "void main() {", THREE.ShaderChunk.logdepthbuf_fragment, "\t#ifdef USE_LOGDEPTHBUF_EXT\n\t\tfloat depth = gl_FragDepthEXT / gl_FragCoord.w;\n\t#else\n\t\tfloat depth = gl_FragCoord.z / gl_FragCoord.w;\n\t#endif\n\tfloat color = 1.0 - smoothstep( mNear, mFar, depth );\n\tgl_FragColor = vec4( vec3( color ), opacity );\n}"].join("\n")
    },
    normal: {
        uniforms: {
            opacity: {
                type: "f",
                value: 1
            }
        },
        vertexShader: ["varying vec3 vNormal;", THREE.ShaderChunk.morphtarget_pars_vertex, THREE.ShaderChunk.logdepthbuf_pars_vertex, "void main() {\n\tvNormal = normalize( normalMatrix * normal );", THREE.ShaderChunk.morphtarget_vertex, THREE.ShaderChunk.default_vertex, THREE.ShaderChunk.logdepthbuf_vertex, "}"].join("\n"),
        fragmentShader: ["uniform float opacity;\nvarying vec3 vNormal;", THREE.ShaderChunk.logdepthbuf_pars_fragment, "void main() {\n\tgl_FragColor = vec4( 0.5 * normalize( vNormal ) + 0.5, opacity );",
            THREE.ShaderChunk.logdepthbuf_fragment, "}"
        ].join("\n")
    },
    normalmap: {
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, THREE.UniformsLib.lights, THREE.UniformsLib.shadowmap, {
            enableAO: {
                type: "i",
                value: 0
            },
            enableDiffuse: {
                type: "i",
                value: 0
            },
            enableSpecular: {
                type: "i",
                value: 0
            },
            enableReflection: {
                type: "i",
                value: 0
            },
            enableDisplacement: {
                type: "i",
                value: 0
            },
            tDisplacement: {
                type: "t",
                value: null
            },
            tDiffuse: {
                type: "t",
                value: null
            },
            tCube: {
                type: "t",
                value: null
            },
            tNormal: {
                type: "t",
                value: null
            },
            tSpecular: {
                type: "t",
                value: null
            },
            tAO: {
                type: "t",
                value: null
            },
            uNormalScale: {
                type: "v2",
                value: new THREE.Vector2(1, 1)
            },
            uDisplacementBias: {
                type: "f",
                value: 0
            },
            uDisplacementScale: {
                type: "f",
                value: 1
            },
            diffuse: {
                type: "c",
                value: new THREE.Color(16777215)
            },
            specular: {
                type: "c",
                value: new THREE.Color(1118481)
            },
            ambient: {
                type: "c",
                value: new THREE.Color(16777215)
            },
            shininess: {
                type: "f",
                value: 30
            },
            opacity: {
                type: "f",
                value: 1
            },
            useRefract: {
                type: "i",
                value: 0
            },
            refractionRatio: {
                type: "f",
                value: 0.98
            },
            reflectivity: {
                type: "f",
                value: 0.5
            },
            uOffset: {
                type: "v2",
                value: new THREE.Vector2(0,
                    0)
            },
            uRepeat: {
                type: "v2",
                value: new THREE.Vector2(1, 1)
            },
            wrapRGB: {
                type: "v3",
                value: new THREE.Vector3(1, 1, 1)
            }
        }]),
        fragmentShader: ["uniform vec3 ambient;\nuniform vec3 diffuse;\nuniform vec3 specular;\nuniform float shininess;\nuniform float opacity;\nuniform bool enableDiffuse;\nuniform bool enableSpecular;\nuniform bool enableAO;\nuniform bool enableReflection;\nuniform sampler2D tDiffuse;\nuniform sampler2D tNormal;\nuniform sampler2D tSpecular;\nuniform sampler2D tAO;\nuniform samplerCube tCube;\nuniform vec2 uNormalScale;\nuniform bool useRefract;\nuniform float refractionRatio;\nuniform float reflectivity;\nvarying vec3 vTangent;\nvarying vec3 vBinormal;\nvarying vec3 vNormal;\nvarying vec2 vUv;\nuniform vec3 ambientLightColor;\n#if MAX_DIR_LIGHTS > 0\n\tuniform vec3 directionalLightColor[ MAX_DIR_LIGHTS ];\n\tuniform vec3 directionalLightDirection[ MAX_DIR_LIGHTS ];\n#endif\n#if MAX_HEMI_LIGHTS > 0\n\tuniform vec3 hemisphereLightSkyColor[ MAX_HEMI_LIGHTS ];\n\tuniform vec3 hemisphereLightGroundColor[ MAX_HEMI_LIGHTS ];\n\tuniform vec3 hemisphereLightDirection[ MAX_HEMI_LIGHTS ];\n#endif\n#if MAX_POINT_LIGHTS > 0\n\tuniform vec3 pointLightColor[ MAX_POINT_LIGHTS ];\n\tuniform vec3 pointLightPosition[ MAX_POINT_LIGHTS ];\n\tuniform float pointLightDistance[ MAX_POINT_LIGHTS ];\n#endif\n#if MAX_SPOT_LIGHTS > 0\n\tuniform vec3 spotLightColor[ MAX_SPOT_LIGHTS ];\n\tuniform vec3 spotLightPosition[ MAX_SPOT_LIGHTS ];\n\tuniform vec3 spotLightDirection[ MAX_SPOT_LIGHTS ];\n\tuniform float spotLightAngleCos[ MAX_SPOT_LIGHTS ];\n\tuniform float spotLightExponent[ MAX_SPOT_LIGHTS ];\n\tuniform float spotLightDistance[ MAX_SPOT_LIGHTS ];\n#endif\n#ifdef WRAP_AROUND\n\tuniform vec3 wrapRGB;\n#endif\nvarying vec3 vWorldPosition;\nvarying vec3 vViewPosition;",
            THREE.ShaderChunk.shadowmap_pars_fragment, THREE.ShaderChunk.fog_pars_fragment, THREE.ShaderChunk.logdepthbuf_pars_fragment, "void main() {", THREE.ShaderChunk.logdepthbuf_fragment, "\tgl_FragColor = vec4( vec3( 1.0 ), opacity );\n\tvec3 specularTex = vec3( 1.0 );\n\tvec3 normalTex = texture2D( tNormal, vUv ).xyz * 2.0 - 1.0;\n\tnormalTex.xy *= uNormalScale;\n\tnormalTex = normalize( normalTex );\n\tif( enableDiffuse ) {\n\t\t#ifdef GAMMA_INPUT\n\t\t\tvec4 texelColor = texture2D( tDiffuse, vUv );\n\t\t\ttexelColor.xyz *= texelColor.xyz;\n\t\t\tgl_FragColor = gl_FragColor * texelColor;\n\t\t#else\n\t\t\tgl_FragColor = gl_FragColor * texture2D( tDiffuse, vUv );\n\t\t#endif\n\t}\n\tif( enableAO ) {\n\t\t#ifdef GAMMA_INPUT\n\t\t\tvec4 aoColor = texture2D( tAO, vUv );\n\t\t\taoColor.xyz *= aoColor.xyz;\n\t\t\tgl_FragColor.xyz = gl_FragColor.xyz * aoColor.xyz;\n\t\t#else\n\t\t\tgl_FragColor.xyz = gl_FragColor.xyz * texture2D( tAO, vUv ).xyz;\n\t\t#endif\n\t}\n\tif( enableSpecular )\n\t\tspecularTex = texture2D( tSpecular, vUv ).xyz;\n\tmat3 tsb = mat3( normalize( vTangent ), normalize( vBinormal ), normalize( vNormal ) );\n\tvec3 finalNormal = tsb * normalTex;\n\t#ifdef FLIP_SIDED\n\t\tfinalNormal = -finalNormal;\n\t#endif\n\tvec3 normal = normalize( finalNormal );\n\tvec3 viewPosition = normalize( vViewPosition );\n\t#if MAX_POINT_LIGHTS > 0\n\t\tvec3 pointDiffuse = vec3( 0.0 );\n\t\tvec3 pointSpecular = vec3( 0.0 );\n\t\tfor ( int i = 0; i < MAX_POINT_LIGHTS; i ++ ) {\n\t\t\tvec4 lPosition = viewMatrix * vec4( pointLightPosition[ i ], 1.0 );\n\t\t\tvec3 pointVector = lPosition.xyz + vViewPosition.xyz;\n\t\t\tfloat pointDistance = 1.0;\n\t\t\tif ( pointLightDistance[ i ] > 0.0 )\n\t\t\t\tpointDistance = 1.0 - min( ( length( pointVector ) / pointLightDistance[ i ] ), 1.0 );\n\t\t\tpointVector = normalize( pointVector );\n\t\t\t#ifdef WRAP_AROUND\n\t\t\t\tfloat pointDiffuseWeightFull = max( dot( normal, pointVector ), 0.0 );\n\t\t\t\tfloat pointDiffuseWeightHalf = max( 0.5 * dot( normal, pointVector ) + 0.5, 0.0 );\n\t\t\t\tvec3 pointDiffuseWeight = mix( vec3( pointDiffuseWeightFull ), vec3( pointDiffuseWeightHalf ), wrapRGB );\n\t\t\t#else\n\t\t\t\tfloat pointDiffuseWeight = max( dot( normal, pointVector ), 0.0 );\n\t\t\t#endif\n\t\t\tpointDiffuse += pointDistance * pointLightColor[ i ] * diffuse * pointDiffuseWeight;\n\t\t\tvec3 pointHalfVector = normalize( pointVector + viewPosition );\n\t\t\tfloat pointDotNormalHalf = max( dot( normal, pointHalfVector ), 0.0 );\n\t\t\tfloat pointSpecularWeight = specularTex.r * max( pow( pointDotNormalHalf, shininess ), 0.0 );\n\t\t\tfloat specularNormalization = ( shininess + 2.0 ) / 8.0;\n\t\t\tvec3 schlick = specular + vec3( 1.0 - specular ) * pow( max( 1.0 - dot( pointVector, pointHalfVector ), 0.0 ), 5.0 );\n\t\t\tpointSpecular += schlick * pointLightColor[ i ] * pointSpecularWeight * pointDiffuseWeight * pointDistance * specularNormalization;\n\t\t}\n\t#endif\n\t#if MAX_SPOT_LIGHTS > 0\n\t\tvec3 spotDiffuse = vec3( 0.0 );\n\t\tvec3 spotSpecular = vec3( 0.0 );\n\t\tfor ( int i = 0; i < MAX_SPOT_LIGHTS; i ++ ) {\n\t\t\tvec4 lPosition = viewMatrix * vec4( spotLightPosition[ i ], 1.0 );\n\t\t\tvec3 spotVector = lPosition.xyz + vViewPosition.xyz;\n\t\t\tfloat spotDistance = 1.0;\n\t\t\tif ( spotLightDistance[ i ] > 0.0 )\n\t\t\t\tspotDistance = 1.0 - min( ( length( spotVector ) / spotLightDistance[ i ] ), 1.0 );\n\t\t\tspotVector = normalize( spotVector );\n\t\t\tfloat spotEffect = dot( spotLightDirection[ i ], normalize( spotLightPosition[ i ] - vWorldPosition ) );\n\t\t\tif ( spotEffect > spotLightAngleCos[ i ] ) {\n\t\t\t\tspotEffect = max( pow( max( spotEffect, 0.0 ), spotLightExponent[ i ] ), 0.0 );\n\t\t\t\t#ifdef WRAP_AROUND\n\t\t\t\t\tfloat spotDiffuseWeightFull = max( dot( normal, spotVector ), 0.0 );\n\t\t\t\t\tfloat spotDiffuseWeightHalf = max( 0.5 * dot( normal, spotVector ) + 0.5, 0.0 );\n\t\t\t\t\tvec3 spotDiffuseWeight = mix( vec3( spotDiffuseWeightFull ), vec3( spotDiffuseWeightHalf ), wrapRGB );\n\t\t\t\t#else\n\t\t\t\t\tfloat spotDiffuseWeight = max( dot( normal, spotVector ), 0.0 );\n\t\t\t\t#endif\n\t\t\t\tspotDiffuse += spotDistance * spotLightColor[ i ] * diffuse * spotDiffuseWeight * spotEffect;\n\t\t\t\tvec3 spotHalfVector = normalize( spotVector + viewPosition );\n\t\t\t\tfloat spotDotNormalHalf = max( dot( normal, spotHalfVector ), 0.0 );\n\t\t\t\tfloat spotSpecularWeight = specularTex.r * max( pow( spotDotNormalHalf, shininess ), 0.0 );\n\t\t\t\tfloat specularNormalization = ( shininess + 2.0 ) / 8.0;\n\t\t\t\tvec3 schlick = specular + vec3( 1.0 - specular ) * pow( max( 1.0 - dot( spotVector, spotHalfVector ), 0.0 ), 5.0 );\n\t\t\t\tspotSpecular += schlick * spotLightColor[ i ] * spotSpecularWeight * spotDiffuseWeight * spotDistance * specularNormalization * spotEffect;\n\t\t\t}\n\t\t}\n\t#endif\n\t#if MAX_DIR_LIGHTS > 0\n\t\tvec3 dirDiffuse = vec3( 0.0 );\n\t\tvec3 dirSpecular = vec3( 0.0 );\n\t\tfor( int i = 0; i < MAX_DIR_LIGHTS; i++ ) {\n\t\t\tvec4 lDirection = viewMatrix * vec4( directionalLightDirection[ i ], 0.0 );\n\t\t\tvec3 dirVector = normalize( lDirection.xyz );\n\t\t\t#ifdef WRAP_AROUND\n\t\t\t\tfloat directionalLightWeightingFull = max( dot( normal, dirVector ), 0.0 );\n\t\t\t\tfloat directionalLightWeightingHalf = max( 0.5 * dot( normal, dirVector ) + 0.5, 0.0 );\n\t\t\t\tvec3 dirDiffuseWeight = mix( vec3( directionalLightWeightingFull ), vec3( directionalLightWeightingHalf ), wrapRGB );\n\t\t\t#else\n\t\t\t\tfloat dirDiffuseWeight = max( dot( normal, dirVector ), 0.0 );\n\t\t\t#endif\n\t\t\tdirDiffuse += directionalLightColor[ i ] * diffuse * dirDiffuseWeight;\n\t\t\tvec3 dirHalfVector = normalize( dirVector + viewPosition );\n\t\t\tfloat dirDotNormalHalf = max( dot( normal, dirHalfVector ), 0.0 );\n\t\t\tfloat dirSpecularWeight = specularTex.r * max( pow( dirDotNormalHalf, shininess ), 0.0 );\n\t\t\tfloat specularNormalization = ( shininess + 2.0 ) / 8.0;\n\t\t\tvec3 schlick = specular + vec3( 1.0 - specular ) * pow( max( 1.0 - dot( dirVector, dirHalfVector ), 0.0 ), 5.0 );\n\t\t\tdirSpecular += schlick * directionalLightColor[ i ] * dirSpecularWeight * dirDiffuseWeight * specularNormalization;\n\t\t}\n\t#endif\n\t#if MAX_HEMI_LIGHTS > 0\n\t\tvec3 hemiDiffuse = vec3( 0.0 );\n\t\tvec3 hemiSpecular = vec3( 0.0 );\n\t\tfor( int i = 0; i < MAX_HEMI_LIGHTS; i ++ ) {\n\t\t\tvec4 lDirection = viewMatrix * vec4( hemisphereLightDirection[ i ], 0.0 );\n\t\t\tvec3 lVector = normalize( lDirection.xyz );\n\t\t\tfloat dotProduct = dot( normal, lVector );\n\t\t\tfloat hemiDiffuseWeight = 0.5 * dotProduct + 0.5;\n\t\t\tvec3 hemiColor = mix( hemisphereLightGroundColor[ i ], hemisphereLightSkyColor[ i ], hemiDiffuseWeight );\n\t\t\themiDiffuse += diffuse * hemiColor;\n\t\t\tvec3 hemiHalfVectorSky = normalize( lVector + viewPosition );\n\t\t\tfloat hemiDotNormalHalfSky = 0.5 * dot( normal, hemiHalfVectorSky ) + 0.5;\n\t\t\tfloat hemiSpecularWeightSky = specularTex.r * max( pow( max( hemiDotNormalHalfSky, 0.0 ), shininess ), 0.0 );\n\t\t\tvec3 lVectorGround = -lVector;\n\t\t\tvec3 hemiHalfVectorGround = normalize( lVectorGround + viewPosition );\n\t\t\tfloat hemiDotNormalHalfGround = 0.5 * dot( normal, hemiHalfVectorGround ) + 0.5;\n\t\t\tfloat hemiSpecularWeightGround = specularTex.r * max( pow( max( hemiDotNormalHalfGround, 0.0 ), shininess ), 0.0 );\n\t\t\tfloat dotProductGround = dot( normal, lVectorGround );\n\t\t\tfloat specularNormalization = ( shininess + 2.0 ) / 8.0;\n\t\t\tvec3 schlickSky = specular + vec3( 1.0 - specular ) * pow( max( 1.0 - dot( lVector, hemiHalfVectorSky ), 0.0 ), 5.0 );\n\t\t\tvec3 schlickGround = specular + vec3( 1.0 - specular ) * pow( max( 1.0 - dot( lVectorGround, hemiHalfVectorGround ), 0.0 ), 5.0 );\n\t\t\themiSpecular += hemiColor * specularNormalization * ( schlickSky * hemiSpecularWeightSky * max( dotProduct, 0.0 ) + schlickGround * hemiSpecularWeightGround * max( dotProductGround, 0.0 ) );\n\t\t}\n\t#endif\n\tvec3 totalDiffuse = vec3( 0.0 );\n\tvec3 totalSpecular = vec3( 0.0 );\n\t#if MAX_DIR_LIGHTS > 0\n\t\ttotalDiffuse += dirDiffuse;\n\t\ttotalSpecular += dirSpecular;\n\t#endif\n\t#if MAX_HEMI_LIGHTS > 0\n\t\ttotalDiffuse += hemiDiffuse;\n\t\ttotalSpecular += hemiSpecular;\n\t#endif\n\t#if MAX_POINT_LIGHTS > 0\n\t\ttotalDiffuse += pointDiffuse;\n\t\ttotalSpecular += pointSpecular;\n\t#endif\n\t#if MAX_SPOT_LIGHTS > 0\n\t\ttotalDiffuse += spotDiffuse;\n\t\ttotalSpecular += spotSpecular;\n\t#endif\n\t#ifdef METAL\n\t\tgl_FragColor.xyz = gl_FragColor.xyz * ( totalDiffuse + ambientLightColor * ambient + totalSpecular );\n\t#else\n\t\tgl_FragColor.xyz = gl_FragColor.xyz * ( totalDiffuse + ambientLightColor * ambient ) + totalSpecular;\n\t#endif\n\tif ( enableReflection ) {\n\t\tvec3 vReflect;\n\t\tvec3 cameraToVertex = normalize( vWorldPosition - cameraPosition );\n\t\tif ( useRefract ) {\n\t\t\tvReflect = refract( cameraToVertex, normal, refractionRatio );\n\t\t} else {\n\t\t\tvReflect = reflect( cameraToVertex, normal );\n\t\t}\n\t\tvec4 cubeColor = textureCube( tCube, vec3( -vReflect.x, vReflect.yz ) );\n\t\t#ifdef GAMMA_INPUT\n\t\t\tcubeColor.xyz *= cubeColor.xyz;\n\t\t#endif\n\t\tgl_FragColor.xyz = mix( gl_FragColor.xyz, cubeColor.xyz, specularTex.r * reflectivity );\n\t}",
            THREE.ShaderChunk.shadowmap_fragment, THREE.ShaderChunk.linear_to_gamma_fragment, THREE.ShaderChunk.fog_fragment, "}"
        ].join("\n"),
        vertexShader: ["attribute vec4 tangent;\nuniform vec2 uOffset;\nuniform vec2 uRepeat;\nuniform bool enableDisplacement;\n#ifdef VERTEX_TEXTURES\n\tuniform sampler2D tDisplacement;\n\tuniform float uDisplacementScale;\n\tuniform float uDisplacementBias;\n#endif\nvarying vec3 vTangent;\nvarying vec3 vBinormal;\nvarying vec3 vNormal;\nvarying vec2 vUv;\nvarying vec3 vWorldPosition;\nvarying vec3 vViewPosition;",
            THREE.ShaderChunk.skinning_pars_vertex, THREE.ShaderChunk.shadowmap_pars_vertex, THREE.ShaderChunk.logdepthbuf_pars_vertex, "void main() {", THREE.ShaderChunk.skinbase_vertex, THREE.ShaderChunk.skinnormal_vertex, "\t#ifdef USE_SKINNING\n\t\tvNormal = normalize( normalMatrix * skinnedNormal.xyz );\n\t\tvec4 skinnedTangent = skinMatrix * vec4( tangent.xyz, 0.0 );\n\t\tvTangent = normalize( normalMatrix * skinnedTangent.xyz );\n\t#else\n\t\tvNormal = normalize( normalMatrix * normal );\n\t\tvTangent = normalize( normalMatrix * tangent.xyz );\n\t#endif\n\tvBinormal = normalize( cross( vNormal, vTangent ) * tangent.w );\n\tvUv = uv * uRepeat + uOffset;\n\tvec3 displacedPosition;\n\t#ifdef VERTEX_TEXTURES\n\t\tif ( enableDisplacement ) {\n\t\t\tvec3 dv = texture2D( tDisplacement, uv ).xyz;\n\t\t\tfloat df = uDisplacementScale * dv.x + uDisplacementBias;\n\t\t\tdisplacedPosition = position + normalize( normal ) * df;\n\t\t} else {\n\t\t\t#ifdef USE_SKINNING\n\t\t\t\tvec4 skinVertex = vec4( position, 1.0 );\n\t\t\t\tvec4 skinned = vec4( 0.0 );\n\t\t\t\tskinned += boneMatX * skinVertex * skinWeight.x;\n\t\t\t\tskinned += boneMatY * skinVertex * skinWeight.y;\n\t\t\t\tskinned += boneMatZ * skinVertex * skinWeight.z;\n\t\t\t\tskinned += boneMatW * skinVertex * skinWeight.w;\n\t\t\t\tdisplacedPosition = skinned.xyz;\n\t\t\t#else\n\t\t\t\tdisplacedPosition = position;\n\t\t\t#endif\n\t\t}\n\t#else\n\t\t#ifdef USE_SKINNING\n\t\t\tvec4 skinVertex = vec4( position, 1.0 );\n\t\t\tvec4 skinned = vec4( 0.0 );\n\t\t\tskinned += boneMatX * skinVertex * skinWeight.x;\n\t\t\tskinned += boneMatY * skinVertex * skinWeight.y;\n\t\t\tskinned += boneMatZ * skinVertex * skinWeight.z;\n\t\t\tskinned += boneMatW * skinVertex * skinWeight.w;\n\t\t\tdisplacedPosition = skinned.xyz;\n\t\t#else\n\t\t\tdisplacedPosition = position;\n\t\t#endif\n\t#endif\n\tvec4 mvPosition = modelViewMatrix * vec4( displacedPosition, 1.0 );\n\tvec4 worldPosition = modelMatrix * vec4( displacedPosition, 1.0 );\n\tgl_Position = projectionMatrix * mvPosition;",
            THREE.ShaderChunk.logdepthbuf_vertex, "\tvWorldPosition = worldPosition.xyz;\n\tvViewPosition = -mvPosition.xyz;\n\t#ifdef USE_SHADOWMAP\n\t\tfor( int i = 0; i < MAX_SHADOWS; i ++ ) {\n\t\t\tvShadowCoord[ i ] = shadowMatrix[ i ] * worldPosition;\n\t\t}\n\t#endif\n}"
        ].join("\n")
    },
    cube: {
        uniforms: {
            tCube: {
                type: "t",
                value: null
            },
            tFlip: {
                type: "f",
                value: -1
            }
        },
        vertexShader: ["varying vec3 vWorldPosition;", THREE.ShaderChunk.logdepthbuf_pars_vertex, "void main() {\n\tvec4 worldPosition = modelMatrix * vec4( position, 1.0 );\n\tvWorldPosition = worldPosition.xyz;\n\tgl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",
            THREE.ShaderChunk.logdepthbuf_vertex, "}"
        ].join("\n"),
        fragmentShader: ["uniform samplerCube tCube;\nuniform float tFlip;\nvarying vec3 vWorldPosition;", THREE.ShaderChunk.logdepthbuf_pars_fragment, "void main() {\n\tgl_FragColor = textureCube( tCube, vec3( tFlip * vWorldPosition.x, vWorldPosition.yz ) );", THREE.ShaderChunk.logdepthbuf_fragment, "}"].join("\n")
    },
    depthRGBA: {
        uniforms: {},
        vertexShader: [THREE.ShaderChunk.morphtarget_pars_vertex, THREE.ShaderChunk.skinning_pars_vertex, THREE.ShaderChunk.logdepthbuf_pars_vertex,
            "void main() {", THREE.ShaderChunk.skinbase_vertex, THREE.ShaderChunk.morphtarget_vertex, THREE.ShaderChunk.skinning_vertex, THREE.ShaderChunk.default_vertex, THREE.ShaderChunk.logdepthbuf_vertex, "}"
        ].join("\n"),
        fragmentShader: [THREE.ShaderChunk.logdepthbuf_pars_fragment, "vec4 pack_depth( const in float depth ) {\n\tconst vec4 bit_shift = vec4( 256.0 * 256.0 * 256.0, 256.0 * 256.0, 256.0, 1.0 );\n\tconst vec4 bit_mask = vec4( 0.0, 1.0 / 256.0, 1.0 / 256.0, 1.0 / 256.0 );\n\tvec4 res = mod( depth * bit_shift * vec4( 255 ), vec4( 256 ) ) / vec4( 255 );\n\tres -= res.xxyz * bit_mask;\n\treturn res;\n}\nvoid main() {",
            THREE.ShaderChunk.logdepthbuf_fragment, "\t#ifdef USE_LOGDEPTHBUF_EXT\n\t\tgl_FragData[ 0 ] = pack_depth( gl_FragDepthEXT );\n\t#else\n\t\tgl_FragData[ 0 ] = pack_depth( gl_FragCoord.z );\n\t#endif\n}"
        ].join("\n")
    }
};
THREE.WebGLRenderer = function(a) {
    function b(a, b) {
        var c = a.vertices.length,
            d = b.material;
        if (d.attributes) {
            void 0 === a.__webglCustomAttributesList && (a.__webglCustomAttributesList = []);
            for (var e in d.attributes) {
                var f = d.attributes[e];
                if (!f.__webglInitialized || f.createUniqueBuffers) {
                    f.__webglInitialized = !0;
                    var g = 1;
                    "v2" === f.type ? g = 2 : "v3" === f.type ? g = 3 : "v4" === f.type ? g = 4 : "c" === f.type && (g = 3);
                    f.size = g;
                    f.array = new Float32Array(c * g);
                    f.buffer = m.createBuffer();
                    f.buffer.belongsToAttribute = e;
                    f.needsUpdate = !0
                }
                a.__webglCustomAttributesList.push(f)
            }
        }
    }

    function c(a, b) {
        var c = b.geometry,
            g = a.faces3,
            h = 3 * g.length,
            k = 1 * g.length,
            l = 3 * g.length,
            g = d(b, a),
            p = f(g),
            n = e(g),
            q = g.vertexColors ? g.vertexColors : !1;
        a.__vertexArray = new Float32Array(3 * h);
        n && (a.__normalArray = new Float32Array(3 * h));
        c.hasTangents && (a.__tangentArray = new Float32Array(4 * h));
        q && (a.__colorArray = new Float32Array(3 * h));
        p && (0 < c.faceVertexUvs.length && (a.__uvArray = new Float32Array(2 * h)), 1 < c.faceVertexUvs.length && (a.__uv2Array = new Float32Array(2 * h)));
        b.geometry.skinWeights.length && b.geometry.skinIndices.length &&
            (a.__skinIndexArray = new Float32Array(4 * h), a.__skinWeightArray = new Float32Array(4 * h));
        c = null !== rb && 21845 < k ? Uint32Array : Uint16Array;
        a.__typeArray = c;
        a.__faceArray = new c(3 * k);
        a.__lineArray = new c(2 * l);
        if (a.numMorphTargets)
            for (a.__morphTargetsArrays = [], c = 0, p = a.numMorphTargets; c < p; c++) a.__morphTargetsArrays.push(new Float32Array(3 * h));
        if (a.numMorphNormals)
            for (a.__morphNormalsArrays = [], c = 0, p = a.numMorphNormals; c < p; c++) a.__morphNormalsArrays.push(new Float32Array(3 * h));
        a.__webglFaceCount = 3 * k;
        a.__webglLineCount =
            2 * l;
        if (g.attributes) {
            void 0 === a.__webglCustomAttributesList && (a.__webglCustomAttributesList = []);
            for (var r in g.attributes) {
                var k = g.attributes[r],
                    l = {},
                    s;
                for (s in k) l[s] = k[s];
                if (!l.__webglInitialized || l.createUniqueBuffers) l.__webglInitialized = !0, c = 1, "v2" === l.type ? c = 2 : "v3" === l.type ? c = 3 : "v4" === l.type ? c = 4 : "c" === l.type && (c = 3), l.size = c, l.array = new Float32Array(h * c), l.buffer = m.createBuffer(), l.buffer.belongsToAttribute = r, k.needsUpdate = !0, l.__original = k;
                a.__webglCustomAttributesList.push(l)
            }
        }
        a.__inittedArrays = !0
    }

    function d(a, b) {
        return a.material instanceof THREE.MeshFaceMaterial ? a.material.materials[b.materialIndex] : a.material
    }

    function e(a) {
        return a instanceof THREE.MeshBasicMaterial && !a.envMap || a instanceof THREE.MeshDepthMaterial ? !1 : a && void 0 !== a.shading && a.shading === THREE.SmoothShading ? THREE.SmoothShading : THREE.FlatShading
    }

    function f(a) {
        return a.map || a.lightMap || a.bumpMap || a.normalMap || a.specularMap || a instanceof THREE.ShaderMaterial ? !0 : !1
    }

    function g(a, b, c, d) {
        for (var e in b) {
            var f = b[e],
                g = c[e];
            if (0 <=
                f)
                if (g) {
                    var h = g.itemSize;
                    m.bindBuffer(m.ARRAY_BUFFER, g.buffer);
                    k(f);
                    m.vertexAttribPointer(f, h, m.FLOAT, !1, 0, d * h * 4)
                } else a.defaultAttributeValues && (2 === a.defaultAttributeValues[e].length ? m.vertexAttrib2fv(f, a.defaultAttributeValues[e]) : 3 === a.defaultAttributeValues[e].length && m.vertexAttrib3fv(f, a.defaultAttributeValues[e]))
        }
        l()
    }

    function h() {
        for (var a = 0, b = ta.length; a < b; a++) ta[a] = 0
    }

    function k(a) {
        ta[a] = 1;
        0 === pb[a] && (m.enableVertexAttribArray(a), pb[a] = 1)
    }

    function l() {
        for (var a = 0, b = pb.length; a < b; a++) pb[a] !==
            ta[a] && (m.disableVertexAttribArray(a), pb[a] = 0)
    }

    function p(a, b) {
        return a.z !== b.z ? b.z - a.z : a.id - b.id
    }

    function q(a, b) {
        return b[0] - a[0]
    }

    function r(a, b, c) {
        if (a.length)
            for (var d = 0, e = a.length; d < e; d++) Ha = wa = null, xa = Ca = La = ba = za = ja = Pa = -1, cb = !0, a[d].render(b, c, va, Ia), Ha = wa = null, xa = Ca = La = ba = za = ja = Pa = -1, cb = !0
    }

    function t(a, b, c, d, e, f, g, h) {
        var k, m, l, p;
        b ? (m = a.length - 1, p = b = -1) : (m = 0, b = a.length, p = 1);
        for (var n = m; n !== b; n += p)
            if (k = a[n], k.render) {
                m = k.object;
                l = k.buffer;
                if (h) k = h;
                else {
                    k = k[c];
                    if (!k) continue;
                    g && M.setBlending(k.blending,
                        k.blendEquation, k.blendSrc, k.blendDst);
                    M.setDepthTest(k.depthTest);
                    M.setDepthWrite(k.depthWrite);
                    y(k.polygonOffset, k.polygonOffsetFactor, k.polygonOffsetUnits)
                }
                M.setMaterialFaces(k);
                l instanceof THREE.BufferGeometry ? M.renderBufferDirect(d, e, f, k, l, m) : M.renderBuffer(d, e, f, k, l, m)
            }
    }

    function s(a, b, c, d, e, f, g) {
        for (var h, k, m = 0, l = a.length; m < l; m++)
            if (h = a[m], k = h.object, k.visible) {
                if (g) h = g;
                else {
                    h = h[b];
                    if (!h) continue;
                    f && M.setBlending(h.blending, h.blendEquation, h.blendSrc, h.blendDst);
                    M.setDepthTest(h.depthTest);
                    M.setDepthWrite(h.depthWrite);
                    y(h.polygonOffset, h.polygonOffsetFactor, h.polygonOffsetUnits)
                }
                M.renderImmediateObject(c, d, e, h, k)
            }
    }

    function n(a, d) {
        var e, f, g;
        if (void 0 === a.__webglInit && (a.__webglInit = !0, a._modelViewMatrix = new THREE.Matrix4, a._normalMatrix = new THREE.Matrix3, f = a.geometry, void 0 !== f && void 0 === f.__webglInit))
            if (f.__webglInit = !0, f.addEventListener("dispose", Cb), f instanceof THREE.BufferGeometry)
                for (g in f.attributes) {
                    var h = "index" === g ? m.ELEMENT_ARRAY_BUFFER : m.ARRAY_BUFFER,
                        k = f.attributes[g];
                    k.buffer = m.createBuffer();
                    m.bindBuffer(h, k.buffer);
                    m.bufferData(h, k.array, m.STATIC_DRAW)
                } else if (a instanceof THREE.Mesh)
                    for (e in g = a.material, void 0 === f.geometryGroups && f.makeGroups(g instanceof THREE.MeshFaceMaterial, rb ? 4294967296 : 65535), f.geometryGroups) {
                        if (g = f.geometryGroups[e], !g.__webglVertexBuffer) {
                            h = g;
                            h.__webglVertexBuffer = m.createBuffer();
                            h.__webglNormalBuffer = m.createBuffer();
                            h.__webglTangentBuffer = m.createBuffer();
                            h.__webglColorBuffer = m.createBuffer();
                            h.__webglUVBuffer = m.createBuffer();
                            h.__webglUV2Buffer = m.createBuffer();
                            h.__webglSkinIndicesBuffer = m.createBuffer();
                            h.__webglSkinWeightsBuffer = m.createBuffer();
                            h.__webglFaceBuffer = m.createBuffer();
                            h.__webglLineBuffer = m.createBuffer();
                            var l = k = void 0;
                            if (h.numMorphTargets)
                                for (h.__webglMorphTargetsBuffers = [], k = 0, l = h.numMorphTargets; k < l; k++) h.__webglMorphTargetsBuffers.push(m.createBuffer());
                            if (h.numMorphNormals)
                                for (h.__webglMorphNormalsBuffers = [], k = 0, l = h.numMorphNormals; k < l; k++) h.__webglMorphNormalsBuffers.push(m.createBuffer());
                            M.info.memory.geometries++;
                            c(g, a);
                            f.verticesNeedUpdate = !0;
                            f.morphTargetsNeedUpdate = !0;
                            f.elementsNeedUpdate = !0;
                            f.uvsNeedUpdate = !0;
                            f.normalsNeedUpdate = !0;
                            f.tangentsNeedUpdate = !0;
                            f.colorsNeedUpdate = !0
                        }
                    } else a instanceof THREE.Line ? f.__webglVertexBuffer || (g = f, g.__webglVertexBuffer = m.createBuffer(), g.__webglColorBuffer = m.createBuffer(), g.__webglLineDistanceBuffer = m.createBuffer(), M.info.memory.geometries++, g = f, h = g.vertices.length, g.__vertexArray = new Float32Array(3 * h), g.__colorArray = new Float32Array(3 * h), g.__lineDistanceArray = new Float32Array(1 *
                        h), g.__webglLineCount = h, b(g, a), f.verticesNeedUpdate = !0, f.colorsNeedUpdate = !0, f.lineDistancesNeedUpdate = !0) : a instanceof THREE.PointCloud && !f.__webglVertexBuffer && (g = f, g.__webglVertexBuffer = m.createBuffer(), g.__webglColorBuffer = m.createBuffer(), M.info.memory.geometries++, g = f, h = g.vertices.length, g.__vertexArray = new Float32Array(3 * h), g.__colorArray = new Float32Array(3 * h), g.__sortArray = [], g.__webglParticleCount = h, b(g, a), f.verticesNeedUpdate = !0, f.colorsNeedUpdate = !0);
        if (void 0 === a.__webglActive) {
            if (a instanceof THREE.Mesh)
                if (f = a.geometry, f instanceof THREE.BufferGeometry) v(d.__webglObjects, f, a);
                else {
                    if (f instanceof THREE.Geometry)
                        for (e in f.geometryGroups) g = f.geometryGroups[e], v(d.__webglObjects, g, a)
                } else a instanceof THREE.Line || a instanceof THREE.PointCloud ? (f = a.geometry, v(d.__webglObjects, f, a)) : a instanceof THREE.ImmediateRenderObject || a.immediateRenderCallback ? d.__webglObjectsImmediate.push({
                id: null,
                object: a,
                opaque: null,
                transparent: null,
                z: 0
            }) : a instanceof THREE.Sprite ? d.__webglSprites.push(a) : a instanceof
            THREE.LensFlare && d.__webglFlares.push(a);
            a.__webglActive = !0
        }
    }

    function v(a, b, c) {
        a.push({
            id: null,
            buffer: b,
            object: c,
            opaque: null,
            transparent: null,
            z: 0
        })
    }

    function w(a) {
        for (var b in a.attributes)
            if (a.attributes[b].needsUpdate) return !0;
        return !1
    }

    function u(a) {
        for (var b in a.attributes) a.attributes[b].needsUpdate = !1
    }

    function x(a, b) {
        a instanceof THREE.Mesh || a instanceof THREE.PointCloud || a instanceof THREE.Line ? K(b.__webglObjects, a) : a instanceof THREE.Sprite ? A(b.__webglSprites, a) : a instanceof THREE.LensFlare ?
            A(b.__webglFlares, a) : (a instanceof THREE.ImmediateRenderObject || a.immediateRenderCallback) && K(b.__webglObjectsImmediate, a);
        delete a.__webglActive
    }

    function K(a, b) {
        for (var c = a.length - 1; 0 <= c; c--) a[c].object === b && a.splice(c, 1)
    }

    function A(a, b) {
        for (var c = a.length - 1; 0 <= c; c--) a[c] === b && a.splice(c, 1)
    }

    function G(a, b, c, d, e) {
        Ea = 0;
        d.needsUpdate && (d.program && Db(d), M.initMaterial(d, b, c, e), d.needsUpdate = !1);
        d.morphTargets && !e.__webglMorphTargetInfluences && (e.__webglMorphTargetInfluences = new Float32Array(M.maxMorphTargets));
        var f = !1,
            g = d.program,
            h = g.uniforms,
            k = d.uniforms;
        g.id !== wa && (m.useProgram(g.program), wa = g.id, f = !0);
        d.id !== xa && (xa = d.id, f = !0);
        if (f || a !== Ha) m.uniformMatrix4fv(h.projectionMatrix, !1, a.projectionMatrix.elements), ha && m.uniform1f(h.logDepthBufFC, 2 / (Math.log(a.far + 1) / Math.LN2)), a !== Ha && (Ha = a);
        if (d.skinning)
            if (Eb && e.skeleton.useVertexTexture) {
                if (null !== h.boneTexture) {
                    var l = B();
                    m.uniform1i(h.boneTexture, l);
                    M.setTexture(e.skeleton.boneTexture, l)
                }
                null !== h.boneTextureWidth && m.uniform1i(h.boneTextureWidth, e.skeleton.boneTextureWidth);
                null !== h.boneTextureHeight && m.uniform1i(h.boneTextureHeight, e.skeleton.boneTextureHeight)
            } else null !== h.boneGlobalMatrices && m.uniformMatrix4fv(h.boneGlobalMatrices, !1, e.skeleton.boneMatrices);
        if (f) {
            c && d.fog && (k.fogColor.value = c.color, c instanceof THREE.Fog ? (k.fogNear.value = c.near, k.fogFar.value = c.far) : c instanceof THREE.FogExp2 && (k.fogDensity.value = c.density));
            if (d instanceof THREE.MeshPhongMaterial || d instanceof THREE.MeshLambertMaterial || d.lights) {
                if (cb) {
                    var p, n = l = 0,
                        q = 0,
                        r, s, t, u = Qb,
                        v = u.directional.colors,
                        w = u.directional.positions,
                        x = u.point.colors,
                        A = u.point.positions,
                        y = u.point.distances,
                        K = u.spot.colors,
                        H = u.spot.positions,
                        F = u.spot.distances,
                        G = u.spot.directions,
                        P = u.spot.anglesCos,
                        z = u.spot.exponents,
                        D = u.hemi.skyColors,
                        N = u.hemi.groundColors,
                        R = u.hemi.positions,
                        S = 0,
                        X = 0,
                        da = 0,
                        W = 0,
                        Y = 0,
                        Z = 0,
                        $ = 0,
                        ia = 0,
                        U = p = 0;
                    c = t = U = 0;
                    for (f = b.length; c < f; c++)
                        if (p = b[c], !p.onlyShadow)
                            if (r = p.color, s = p.intensity, t = p.distance, p instanceof THREE.AmbientLight) p.visible && (M.gammaInput ? (l += r.r * r.r, n += r.g * r.g, q += r.b * r.b) : (l += r.r, n += r.g, q += r.b));
                            else if (p instanceof THREE.DirectionalLight) {
                        if (Y += 1, p.visible && (pa.setFromMatrixPosition(p.matrixWorld), ya.setFromMatrixPosition(p.target.matrixWorld), pa.sub(ya), pa.normalize(), 0 !== pa.x || 0 !== pa.y || 0 !== pa.z)) p = 3 * S, w[p] = pa.x, w[p + 1] = pa.y, w[p + 2] = pa.z, M.gammaInput ? C(v, p, r, s * s) : E(v, p, r, s), S += 1
                    } else p instanceof THREE.PointLight ? (Z += 1, p.visible && (U = 3 * X, M.gammaInput ? C(x, U, r, s * s) : E(x, U, r, s), ya.setFromMatrixPosition(p.matrixWorld), A[U] = ya.x, A[U + 1] = ya.y, A[U + 2] = ya.z, y[X] = t, X += 1)) : p instanceof THREE.SpotLight ?
                        ($ += 1, p.visible && (U = 3 * da, M.gammaInput ? C(K, U, r, s * s) : E(K, U, r, s), ya.setFromMatrixPosition(p.matrixWorld), H[U] = ya.x, H[U + 1] = ya.y, H[U + 2] = ya.z, F[da] = t, pa.copy(ya), ya.setFromMatrixPosition(p.target.matrixWorld), pa.sub(ya), pa.normalize(), G[U] = pa.x, G[U + 1] = pa.y, G[U + 2] = pa.z, P[da] = Math.cos(p.angle), z[da] = p.exponent, da += 1)) : p instanceof THREE.HemisphereLight && (ia += 1, p.visible && (pa.setFromMatrixPosition(p.matrixWorld), pa.normalize(), 0 !== pa.x || 0 !== pa.y || 0 !== pa.z)) && (t = 3 * W, R[t] = pa.x, R[t + 1] = pa.y, R[t + 2] = pa.z, r = p.color,
                            p = p.groundColor, M.gammaInput ? (s *= s, C(D, t, r, s), C(N, t, p, s)) : (E(D, t, r, s), E(N, t, p, s)), W += 1);
                    c = 3 * S;
                    for (f = Math.max(v.length, 3 * Y); c < f; c++) v[c] = 0;
                    c = 3 * X;
                    for (f = Math.max(x.length, 3 * Z); c < f; c++) x[c] = 0;
                    c = 3 * da;
                    for (f = Math.max(K.length, 3 * $); c < f; c++) K[c] = 0;
                    c = 3 * W;
                    for (f = Math.max(D.length, 3 * ia); c < f; c++) D[c] = 0;
                    c = 3 * W;
                    for (f = Math.max(N.length, 3 * ia); c < f; c++) N[c] = 0;
                    u.directional.length = S;
                    u.point.length = X;
                    u.spot.length = da;
                    u.hemi.length = W;
                    u.ambient[0] = l;
                    u.ambient[1] = n;
                    u.ambient[2] = q;
                    cb = !1
                }
                c = Qb;
                k.ambientLightColor.value = c.ambient;
                k.directionalLightColor.value = c.directional.colors;
                k.directionalLightDirection.value = c.directional.positions;
                k.pointLightColor.value = c.point.colors;
                k.pointLightPosition.value = c.point.positions;
                k.pointLightDistance.value = c.point.distances;
                k.spotLightColor.value = c.spot.colors;
                k.spotLightPosition.value = c.spot.positions;
                k.spotLightDistance.value = c.spot.distances;
                k.spotLightDirection.value = c.spot.directions;
                k.spotLightAngleCos.value = c.spot.anglesCos;
                k.spotLightExponent.value = c.spot.exponents;
                k.hemisphereLightSkyColor.value =
                    c.hemi.skyColors;
                k.hemisphereLightGroundColor.value = c.hemi.groundColors;
                k.hemisphereLightDirection.value = c.hemi.positions
            }
            if (d instanceof THREE.MeshBasicMaterial || d instanceof THREE.MeshLambertMaterial || d instanceof THREE.MeshPhongMaterial) {
                k.opacity.value = d.opacity;
                M.gammaInput ? k.diffuse.value.copyGammaToLinear(d.color) : k.diffuse.value = d.color;
                k.map.value = d.map;
                k.lightMap.value = d.lightMap;
                k.specularMap.value = d.specularMap;
                d.bumpMap && (k.bumpMap.value = d.bumpMap, k.bumpScale.value = d.bumpScale);
                d.normalMap &&
                    (k.normalMap.value = d.normalMap, k.normalScale.value.copy(d.normalScale));
                var ba;
                d.map ? ba = d.map : d.specularMap ? ba = d.specularMap : d.normalMap ? ba = d.normalMap : d.bumpMap && (ba = d.bumpMap);
                void 0 !== ba && (c = ba.offset, ba = ba.repeat, k.offsetRepeat.value.set(c.x, c.y, ba.x, ba.y));
                k.envMap.value = d.envMap;
                k.flipEnvMap.value = d.envMap instanceof THREE.WebGLRenderTargetCube ? 1 : -1;
                k.reflectivity.value = d.reflectivity;
                k.refractionRatio.value = d.refractionRatio;
                k.combine.value = d.combine;
                k.useRefract.value = d.envMap && d.envMap.mapping instanceof
                THREE.CubeRefractionMapping
            }
            d instanceof THREE.LineBasicMaterial ? (k.diffuse.value = d.color, k.opacity.value = d.opacity) : d instanceof THREE.LineDashedMaterial ? (k.diffuse.value = d.color, k.opacity.value = d.opacity, k.dashSize.value = d.dashSize, k.totalSize.value = d.dashSize + d.gapSize, k.scale.value = d.scale) : d instanceof THREE.PointCloudMaterial ? (k.psColor.value = d.color, k.opacity.value = d.opacity, k.size.value = d.size, k.scale.value = I.height / 2, k.map.value = d.map) : d instanceof THREE.MeshPhongMaterial ? (k.shininess.value =
                d.shininess, M.gammaInput ? (k.ambient.value.copyGammaToLinear(d.ambient), k.emissive.value.copyGammaToLinear(d.emissive), k.specular.value.copyGammaToLinear(d.specular)) : (k.ambient.value = d.ambient, k.emissive.value = d.emissive, k.specular.value = d.specular), d.wrapAround && k.wrapRGB.value.copy(d.wrapRGB)) : d instanceof THREE.MeshLambertMaterial ? (M.gammaInput ? (k.ambient.value.copyGammaToLinear(d.ambient), k.emissive.value.copyGammaToLinear(d.emissive)) : (k.ambient.value = d.ambient, k.emissive.value = d.emissive), d.wrapAround &&
                k.wrapRGB.value.copy(d.wrapRGB)) : d instanceof THREE.MeshDepthMaterial ? (k.mNear.value = a.near, k.mFar.value = a.far, k.opacity.value = d.opacity) : d instanceof THREE.MeshNormalMaterial && (k.opacity.value = d.opacity);
            if (e.receiveShadow && !d._shadowPass && k.shadowMatrix)
                for (c = ba = 0, f = b.length; c < f; c++) l = b[c], l.castShadow && (l instanceof THREE.SpotLight || l instanceof THREE.DirectionalLight && !l.shadowCascade) && (k.shadowMap.value[ba] = l.shadowMap, k.shadowMapSize.value[ba] = l.shadowMapSize, k.shadowMatrix.value[ba] = l.shadowMatrix,
                    k.shadowDarkness.value[ba] = l.shadowDarkness, k.shadowBias.value[ba] = l.shadowBias, ba++);
            b = d.uniformsList;
            k = 0;
            for (ba = b.length; k < ba; k++)
                if (f = g.uniforms[b[k][1]])
                    if (c = b[k][0], n = c.type, l = c.value, "i" === n) m.uniform1i(f, l);
                    else if ("f" === n) m.uniform1f(f, l);
            else if ("v2" === n) m.uniform2f(f, l.x, l.y);
            else if ("v3" === n) m.uniform3f(f, l.x, l.y, l.z);
            else if ("v4" === n) m.uniform4f(f, l.x, l.y, l.z, l.w);
            else if ("c" === n) m.uniform3f(f, l.r, l.g, l.b);
            else if ("iv1" === n) m.uniform1iv(f, l);
            else if ("iv" === n) m.uniform3iv(f, l);
            else if ("fv1" ===
                n) m.uniform1fv(f, l);
            else if ("fv" === n) m.uniform3fv(f, l);
            else if ("v2v" === n) {
                void 0 === c._array && (c._array = new Float32Array(2 * l.length));
                n = 0;
                for (q = l.length; n < q; n++) u = 2 * n, c._array[u] = l[n].x, c._array[u + 1] = l[n].y;
                m.uniform2fv(f, c._array)
            } else if ("v3v" === n) {
                void 0 === c._array && (c._array = new Float32Array(3 * l.length));
                n = 0;
                for (q = l.length; n < q; n++) u = 3 * n, c._array[u] = l[n].x, c._array[u + 1] = l[n].y, c._array[u + 2] = l[n].z;
                m.uniform3fv(f, c._array)
            } else if ("v4v" === n) {
                void 0 === c._array && (c._array = new Float32Array(4 * l.length));
                n = 0;
                for (q = l.length; n < q; n++) u = 4 * n, c._array[u] = l[n].x, c._array[u + 1] = l[n].y, c._array[u + 2] = l[n].z, c._array[u + 3] = l[n].w;
                m.uniform4fv(f, c._array)
            } else if ("m3" === n) m.uniformMatrix3fv(f, !1, l.elements);
            else if ("m3v" === n) {
                void 0 === c._array && (c._array = new Float32Array(9 * l.length));
                n = 0;
                for (q = l.length; n < q; n++) l[n].flattenToArrayOffset(c._array, 9 * n);
                m.uniformMatrix3fv(f, !1, c._array)
            } else if ("m4" === n) m.uniformMatrix4fv(f, !1, l.elements);
            else if ("m4v" === n) {
                void 0 === c._array && (c._array = new Float32Array(16 * l.length));
                n = 0;
                for (q = l.length; n < q; n++) l[n].flattenToArrayOffset(c._array, 16 * n);
                m.uniformMatrix4fv(f, !1, c._array)
            } else if ("t" === n) {
                if (u = l, l = B(), m.uniform1i(f, l), u)
                    if (u instanceof THREE.CubeTexture || u.image instanceof Array && 6 === u.image.length) {
                        if (c = u, f = l, 6 === c.image.length)
                            if (c.needsUpdate) {
                                c.image.__webglTextureCube || (c.addEventListener("dispose", Fb), c.image.__webglTextureCube = m.createTexture(), M.info.memory.textures++);
                                m.activeTexture(m.TEXTURE0 + f);
                                m.bindTexture(m.TEXTURE_CUBE_MAP, c.image.__webglTextureCube);
                                m.pixelStorei(m.UNPACK_FLIP_Y_WEBGL, c.flipY);
                                f = c instanceof THREE.CompressedTexture;
                                l = [];
                                for (n = 0; 6 > n; n++) M.autoScaleCubemaps && !f ? (q = l, u = n, v = c.image[n], x = bc, v.width <= x && v.height <= x || (A = Math.max(v.width, v.height), w = Math.floor(v.width * x / A), x = Math.floor(v.height * x / A), A = document.createElement("canvas"), A.width = w, A.height = x, A.getContext("2d").drawImage(v, 0, 0, v.width, v.height, 0, 0, w, x), v = A), q[u] = v) : l[n] = c.image[n];
                                n = l[0];
                                q = THREE.Math.isPowerOfTwo(n.width) && THREE.Math.isPowerOfTwo(n.height);
                                u = L(c.format);
                                v = L(c.type);
                                Q(m.TEXTURE_CUBE_MAP, c, q);
                                for (n = 0; 6 > n; n++)
                                    if (f)
                                        for (x = l[n].mipmaps, A = 0, y = x.length; A < y; A++) w = x[A], c.format !== THREE.RGBAFormat ? m.compressedTexImage2D(m.TEXTURE_CUBE_MAP_POSITIVE_X + n, A, u, w.width, w.height, 0, w.data) : m.texImage2D(m.TEXTURE_CUBE_MAP_POSITIVE_X + n, A, u, w.width, w.height, 0, u, v, w.data);
                                    else m.texImage2D(m.TEXTURE_CUBE_MAP_POSITIVE_X + n, 0, u, u, v, l[n]);
                                c.generateMipmaps && q && m.generateMipmap(m.TEXTURE_CUBE_MAP);
                                c.needsUpdate = !1;
                                if (c.onUpdate) c.onUpdate()
                            } else m.activeTexture(m.TEXTURE0 +
                                f), m.bindTexture(m.TEXTURE_CUBE_MAP, c.image.__webglTextureCube)
                    } else u instanceof THREE.WebGLRenderTargetCube ? (c = u, m.activeTexture(m.TEXTURE0 + l), m.bindTexture(m.TEXTURE_CUBE_MAP, c.__webglTexture)) : M.setTexture(u, l)
            } else if ("tv" === n) {
                void 0 === c._array && (c._array = []);
                n = 0;
                for (q = c.value.length; n < q; n++) c._array[n] = B();
                m.uniform1iv(f, c._array);
                n = 0;
                for (q = c.value.length; n < q; n++) u = c.value[n], l = c._array[n], u && M.setTexture(u, l)
            } else console.warn("THREE.WebGLRenderer: Unknown uniform type: " + n);
            (d instanceof THREE.ShaderMaterial || d instanceof THREE.MeshPhongMaterial || d.envMap) && null !== h.cameraPosition && (ya.setFromMatrixPosition(a.matrixWorld), m.uniform3f(h.cameraPosition, ya.x, ya.y, ya.z));
            (d instanceof THREE.MeshPhongMaterial || d instanceof THREE.MeshLambertMaterial || d instanceof THREE.ShaderMaterial || d.skinning) && null !== h.viewMatrix && m.uniformMatrix4fv(h.viewMatrix, !1, a.matrixWorldInverse.elements)
        }
        m.uniformMatrix4fv(h.modelViewMatrix, !1, e._modelViewMatrix.elements);
        h.normalMatrix && m.uniformMatrix3fv(h.normalMatrix, !1, e._normalMatrix.elements);
        null !== h.modelMatrix && m.uniformMatrix4fv(h.modelMatrix, !1, e.matrixWorld.elements);
        return g
    }

    function B() {
        var a = Ea;
        a >= mb && console.warn("WebGLRenderer: trying to use " + a + " texture units while this GPU supports only " + mb);
        Ea += 1;
        return a
    }

    function C(a, b, c, d) {
        a[b] = c.r * c.r * d;
        a[b + 1] = c.g * c.g * d;
        a[b + 2] = c.b * c.b * d
    }

    function E(a, b, c, d) {
        a[b] = c.r * d;
        a[b + 1] = c.g * d;
        a[b + 2] = c.b * d
    }

    function H(a) {
        a !== ua && (m.lineWidth(a), ua = a)
    }

    function y(a, b, c) {
        ca !== a && (a ? m.enable(m.POLYGON_OFFSET_FILL) : m.disable(m.POLYGON_OFFSET_FILL),
            ca = a);
        !a || ma === b && oa === c || (m.polygonOffset(b, c), ma = b, oa = c)
    }

    function Q(a, b, c) {
        c ? (m.texParameteri(a, m.TEXTURE_WRAP_S, L(b.wrapS)), m.texParameteri(a, m.TEXTURE_WRAP_T, L(b.wrapT)), m.texParameteri(a, m.TEXTURE_MAG_FILTER, L(b.magFilter)), m.texParameteri(a, m.TEXTURE_MIN_FILTER, L(b.minFilter))) : (m.texParameteri(a, m.TEXTURE_WRAP_S, m.CLAMP_TO_EDGE), m.texParameteri(a, m.TEXTURE_WRAP_T, m.CLAMP_TO_EDGE), m.texParameteri(a, m.TEXTURE_MAG_FILTER, R(b.magFilter)), m.texParameteri(a, m.TEXTURE_MIN_FILTER, R(b.minFilter)));
        db && b.type !== THREE.FloatType && (1 < b.anisotropy || b.__oldAnisotropy) && (m.texParameterf(a, db.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(b.anisotropy, Gb)), b.__oldAnisotropy = b.anisotropy)
    }

    function z(a, b) {
        m.bindRenderbuffer(m.RENDERBUFFER, a);
        b.depthBuffer && !b.stencilBuffer ? (m.renderbufferStorage(m.RENDERBUFFER, m.DEPTH_COMPONENT16, b.width, b.height), m.framebufferRenderbuffer(m.FRAMEBUFFER, m.DEPTH_ATTACHMENT, m.RENDERBUFFER, a)) : b.depthBuffer && b.stencilBuffer ? (m.renderbufferStorage(m.RENDERBUFFER, m.DEPTH_STENCIL, b.width,
            b.height), m.framebufferRenderbuffer(m.FRAMEBUFFER, m.DEPTH_STENCIL_ATTACHMENT, m.RENDERBUFFER, a)) : m.renderbufferStorage(m.RENDERBUFFER, m.RGBA4, b.width, b.height)
    }

    function R(a) {
        return a === THREE.NearestFilter || a === THREE.NearestMipMapNearestFilter || a === THREE.NearestMipMapLinearFilter ? m.NEAREST : m.LINEAR
    }

    function L(a) {
        if (a === THREE.RepeatWrapping) return m.REPEAT;
        if (a === THREE.ClampToEdgeWrapping) return m.CLAMP_TO_EDGE;
        if (a === THREE.MirroredRepeatWrapping) return m.MIRRORED_REPEAT;
        if (a === THREE.NearestFilter) return m.NEAREST;
        if (a === THREE.NearestMipMapNearestFilter) return m.NEAREST_MIPMAP_NEAREST;
        if (a === THREE.NearestMipMapLinearFilter) return m.NEAREST_MIPMAP_LINEAR;
        if (a === THREE.LinearFilter) return m.LINEAR;
        if (a === THREE.LinearMipMapNearestFilter) return m.LINEAR_MIPMAP_NEAREST;
        if (a === THREE.LinearMipMapLinearFilter) return m.LINEAR_MIPMAP_LINEAR;
        if (a === THREE.UnsignedByteType) return m.UNSIGNED_BYTE;
        if (a === THREE.UnsignedShort4444Type) return m.UNSIGNED_SHORT_4_4_4_4;
        if (a === THREE.UnsignedShort5551Type) return m.UNSIGNED_SHORT_5_5_5_1;
        if (a === THREE.UnsignedShort565Type) return m.UNSIGNED_SHORT_5_6_5;
        if (a === THREE.ByteType) return m.BYTE;
        if (a === THREE.ShortType) return m.SHORT;
        if (a === THREE.UnsignedShortType) return m.UNSIGNED_SHORT;
        if (a === THREE.IntType) return m.INT;
        if (a === THREE.UnsignedIntType) return m.UNSIGNED_INT;
        if (a === THREE.FloatType) return m.FLOAT;
        if (a === THREE.AlphaFormat) return m.ALPHA;
        if (a === THREE.RGBFormat) return m.RGB;
        if (a === THREE.RGBAFormat) return m.RGBA;
        if (a === THREE.LuminanceFormat) return m.LUMINANCE;
        if (a === THREE.LuminanceAlphaFormat) return m.LUMINANCE_ALPHA;
        if (a === THREE.AddEquation) return m.FUNC_ADD;
        if (a === THREE.SubtractEquation) return m.FUNC_SUBTRACT;
        if (a === THREE.ReverseSubtractEquation) return m.FUNC_REVERSE_SUBTRACT;
        if (a === THREE.ZeroFactor) return m.ZERO;
        if (a === THREE.OneFactor) return m.ONE;
        if (a === THREE.SrcColorFactor) return m.SRC_COLOR;
        if (a === THREE.OneMinusSrcColorFactor) return m.ONE_MINUS_SRC_COLOR;
        if (a === THREE.SrcAlphaFactor) return m.SRC_ALPHA;
        if (a === THREE.OneMinusSrcAlphaFactor) return m.ONE_MINUS_SRC_ALPHA;
        if (a === THREE.DstAlphaFactor) return m.DST_ALPHA;
        if (a === THREE.OneMinusDstAlphaFactor) return m.ONE_MINUS_DST_ALPHA;
        if (a === THREE.DstColorFactor) return m.DST_COLOR;
        if (a === THREE.OneMinusDstColorFactor) return m.ONE_MINUS_DST_COLOR;
        if (a === THREE.SrcAlphaSaturateFactor) return m.SRC_ALPHA_SATURATE;
        if (void 0 !== Qa) {
            if (a === THREE.RGB_S3TC_DXT1_Format) return Qa.COMPRESSED_RGB_S3TC_DXT1_EXT;
            if (a === THREE.RGBA_S3TC_DXT1_Format) return Qa.COMPRESSED_RGBA_S3TC_DXT1_EXT;
            if (a === THREE.RGBA_S3TC_DXT3_Format) return Qa.COMPRESSED_RGBA_S3TC_DXT3_EXT;
            if (a === THREE.RGBA_S3TC_DXT5_Format) return Qa.COMPRESSED_RGBA_S3TC_DXT5_EXT
        }
        return 0
    }
    console.log("THREE.WebGLRenderer", THREE.REVISION);
    a = a || {};
    var I = void 0 !== a.canvas ? a.canvas : document.createElement("canvas"),
        F = void 0 !== a.context ? a.context : null,
        P = void 0 !== a.precision ? a.precision : "highp",
        X = void 0 !== a.alpha ? a.alpha : !1,
        N = void 0 !== a.depth ? a.depth : !0,
        la = void 0 !== a.stencil ? a.stencil : !0,
        S = void 0 !== a.antialias ? a.antialias : !1,
        W = void 0 !== a.premultipliedAlpha ? a.premultipliedAlpha : !0,
        D = void 0 !== a.preserveDrawingBuffer ? a.preserveDrawingBuffer : !1,
        ha = void 0 !== a.logarithmicDepthBuffer ? a.logarithmicDepthBuffer :
        !1,
        fa = new THREE.Color(0),
        U = 0;
    this.domElement = I;
    this.context = null;
    this.devicePixelRatio = void 0 !== a.devicePixelRatio ? a.devicePixelRatio : void 0 !== self.devicePixelRatio ? self.devicePixelRatio : 1;
    this.autoUpdateObjects = this.sortObjects = this.autoClearStencil = this.autoClearDepth = this.autoClearColor = this.autoClear = !0;
    this.shadowMapEnabled = this.gammaOutput = this.gammaInput = !1;
    this.shadowMapAutoUpdate = !0;
    this.shadowMapType = THREE.PCFShadowMap;
    this.shadowMapCullFace = THREE.CullFaceFront;
    this.shadowMapCascade = this.shadowMapDebug = !1;
    this.maxMorphTargets = 8;
    this.maxMorphNormals = 4;
    this.autoScaleCubemaps = !0;
    this.renderPluginsPre = [];
    this.renderPluginsPost = [];
    this.info = {
        memory: {
            programs: 0,
            geometries: 0,
            textures: 0
        },
        render: {
            calls: 0,
            vertices: 0,
            faces: 0,
            points: 0
        }
    };
    var M = this,
        da = [],
        wa = null,
        ia = null,
        xa = -1,
        Ca = null,
        Ha = null,
        Ea = 0,
        ba = -1,
        La = -1,
        Pa = -1,
        Sa = -1,
        Ta = -1,
        Ja = -1,
        ja = -1,
        za = -1,
        ca = null,
        ma = null,
        oa = null,
        ua = null,
        Da = 0,
        Ka = 0,
        Fa = I.width,
        ea = I.height,
        va = 0,
        Ia = 0,
        ta = new Uint8Array(16),
        pb = new Uint8Array(16),
        Bb = new THREE.Frustum,
        Pb = new THREE.Matrix4,
        ac = new THREE.Matrix4,
        ya = new THREE.Vector3,
        pa = new THREE.Vector3,
        cb = !0,
        Qb = {
            ambient: [0, 0, 0],
            directional: {
                length: 0,
                colors: [],
                positions: []
            },
            point: {
                length: 0,
                colors: [],
                positions: [],
                distances: []
            },
            spot: {
                length: 0,
                colors: [],
                positions: [],
                distances: [],
                directions: [],
                anglesCos: [],
                exponents: []
            },
            hemi: {
                length: 0,
                skyColors: [],
                groundColors: [],
                positions: []
            }
        },
        m, qb, yb, db, Qa, rb;
    (function() {
        try {
            var a = {
                alpha: X,
                depth: N,
                stencil: la,
                antialias: S,
                premultipliedAlpha: W,
                preserveDrawingBuffer: D
            };
            m = F || I.getContext("webgl", a) || I.getContext("experimental-webgl",
                a);
            if (null === m) throw "Error creating WebGL context.";
        } catch (b) {
            console.error(b)
        }
        qb = m.getExtension("OES_texture_float");
        m.getExtension("OES_texture_float_linear");
        yb = m.getExtension("OES_standard_derivatives");
        db = m.getExtension("EXT_texture_filter_anisotropic") || m.getExtension("MOZ_EXT_texture_filter_anisotropic") || m.getExtension("WEBKIT_EXT_texture_filter_anisotropic");
        Qa = m.getExtension("WEBGL_compressed_texture_s3tc") || m.getExtension("MOZ_WEBGL_compressed_texture_s3tc") || m.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc");
        rb = m.getExtension("OES_element_index_uint");
        null === qb && console.log("THREE.WebGLRenderer: Float textures not supported.");
        null === yb && console.log("THREE.WebGLRenderer: Standard derivatives not supported.");
        null === db && console.log("THREE.WebGLRenderer: Anisotropic texture filtering not supported.");
        null === Qa && console.log("THREE.WebGLRenderer: S3TC compressed textures not supported.");
        null === rb && console.log("THREE.WebGLRenderer: elementindex as unsigned integer not supported.");
        void 0 === m.getShaderPrecisionFormat &&
            (m.getShaderPrecisionFormat = function() {
                return {
                    rangeMin: 1,
                    rangeMax: 1,
                    precision: 1
                }
            });
        ha && m.getExtension("EXT_frag_depth")
    })();
    m.clearColor(0, 0, 0, 1);
    m.clearDepth(1);
    m.clearStencil(0);
    m.enable(m.DEPTH_TEST);
    m.depthFunc(m.LEQUAL);
    m.frontFace(m.CCW);
    m.cullFace(m.BACK);
    m.enable(m.CULL_FACE);
    m.enable(m.BLEND);
    m.blendEquation(m.FUNC_ADD);
    m.blendFunc(m.SRC_ALPHA, m.ONE_MINUS_SRC_ALPHA);
    m.viewport(Da, Ka, Fa, ea);
    m.clearColor(fa.r, fa.g, fa.b, U);
    this.context = m;
    var mb = m.getParameter(m.MAX_TEXTURE_IMAGE_UNITS),
        cc = m.getParameter(m.MAX_VERTEX_TEXTURE_IMAGE_UNITS);
    m.getParameter(m.MAX_TEXTURE_SIZE);
    var bc = m.getParameter(m.MAX_CUBE_MAP_TEXTURE_SIZE),
        Gb = db ? m.getParameter(db.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 0,
        Hb = 0 < cc,
        Eb = Hb && qb;
    Qa && m.getParameter(m.COMPRESSED_TEXTURE_FORMATS);
    var dc = m.getShaderPrecisionFormat(m.VERTEX_SHADER, m.HIGH_FLOAT),
        ec = m.getShaderPrecisionFormat(m.VERTEX_SHADER, m.MEDIUM_FLOAT);
    m.getShaderPrecisionFormat(m.VERTEX_SHADER, m.LOW_FLOAT);
    var qc = m.getShaderPrecisionFormat(m.FRAGMENT_SHADER, m.HIGH_FLOAT),
        rc = m.getShaderPrecisionFormat(m.FRAGMENT_SHADER,
            m.MEDIUM_FLOAT);
    m.getShaderPrecisionFormat(m.FRAGMENT_SHADER, m.LOW_FLOAT);
    var sc = 0 < dc.precision && 0 < qc.precision,
        Ib = 0 < ec.precision && 0 < rc.precision;
    "highp" !== P || sc || (Ib ? (P = "mediump", console.warn("THREE.WebGLRenderer: highp not supported, using mediump.")) : (P = "lowp", console.warn("THREE.WebGLRenderer: highp and mediump not supported, using lowp.")));
    "mediump" !== P || Ib || (P = "lowp", console.warn("THREE.WebGLRenderer: mediump not supported, using lowp."));
    this.getContext = function() {
        return m
    };
    this.supportsVertexTextures =
        function() {
            return Hb
        };
    this.supportsFloatTextures = function() {
        return qb
    };
    this.supportsStandardDerivatives = function() {
        return yb
    };
    this.supportsCompressedTextureS3TC = function() {
        return Qa
    };
    this.getMaxAnisotropy = function() {
        return Gb
    };
    this.getPrecision = function() {
        return P
    };
    this.setSize = function(a, b, c) {
        I.width = a * this.devicePixelRatio;
        I.height = b * this.devicePixelRatio;
        !1 !== c && (I.style.width = a + "px", I.style.height = b + "px");
        this.setViewport(0, 0, a, b)
    };
    this.setViewport = function(a, b, c, d) {
        Da = a * this.devicePixelRatio;
        Ka = b * this.devicePixelRatio;
        Fa = c * this.devicePixelRatio;
        ea = d * this.devicePixelRatio;
        m.viewport(Da, Ka, Fa, ea)
    };
    this.setScissor = function(a, b, c, d) {
        m.scissor(a * this.devicePixelRatio, b * this.devicePixelRatio, c * this.devicePixelRatio, d * this.devicePixelRatio)
    };
    this.enableScissorTest = function(a) {
        a ? m.enable(m.SCISSOR_TEST) : m.disable(m.SCISSOR_TEST)
    };
    this.setClearColor = function(a, b) {
        fa.set(a);
        U = void 0 !== b ? b : 1;
        m.clearColor(fa.r, fa.g, fa.b, U)
    };
    this.setClearColorHex = function(a, b) {
        console.warn("THREE.WebGLRenderer: .setClearColorHex() is being removed. Use .setClearColor() instead.");
        this.setClearColor(a, b)
    };
    this.getClearColor = function() {
        return fa
    };
    this.getClearAlpha = function() {
        return U
    };
    this.clear = function(a, b, c) {
        var d = 0;
        if (void 0 === a || a) d |= m.COLOR_BUFFER_BIT;
        if (void 0 === b || b) d |= m.DEPTH_BUFFER_BIT;
        if (void 0 === c || c) d |= m.STENCIL_BUFFER_BIT;
        m.clear(d)
    };
    this.clearColor = function() {
        m.clear(m.COLOR_BUFFER_BIT)
    };
    this.clearDepth = function() {
        m.clear(m.DEPTH_BUFFER_BIT)
    };
    this.clearStencil = function() {
        m.clear(m.STENCIL_BUFFER_BIT)
    };
    this.clearTarget = function(a, b, c, d) {
        this.setRenderTarget(a);
        this.clear(b, c, d)
    };
    this.addPostPlugin = function(a) {
        a.init(this);
        this.renderPluginsPost.push(a)
    };
    this.addPrePlugin = function(a) {
        a.init(this);
        this.renderPluginsPre.push(a)
    };
    this.updateShadowMap = function(a, b) {
        wa = null;
        xa = Ca = za = ja = Pa = -1;
        cb = !0;
        La = ba = -1;
        this.shadowMapPlugin.update(a, b)
    };
    var Cb = function(a) {
            a = a.target;
            a.removeEventListener("dispose", Cb);
            a.__webglInit = void 0;
            if (a instanceof THREE.BufferGeometry) {
                var b = a.attributes,
                    c;
                for (c in b) void 0 !== b[c].buffer && m.deleteBuffer(b[c].buffer);
                M.info.memory.geometries--
            } else if (void 0 !==
                a.geometryGroups)
                for (b in a.geometryGroups) {
                    c = a.geometryGroups[b];
                    if (void 0 !== c.numMorphTargets)
                        for (var d = 0, e = c.numMorphTargets; d < e; d++) m.deleteBuffer(c.__webglMorphTargetsBuffers[d]);
                    if (void 0 !== c.numMorphNormals)
                        for (d = 0, e = c.numMorphNormals; d < e; d++) m.deleteBuffer(c.__webglMorphNormalsBuffers[d]);
                    Jb(c)
                } else Jb(a)
        },
        Fb = function(a) {
            a = a.target;
            a.removeEventListener("dispose", Fb);
            a.image && a.image.__webglTextureCube ? m.deleteTexture(a.image.__webglTextureCube) : a.__webglInit && (a.__webglInit = !1, m.deleteTexture(a.__webglTexture));
            M.info.memory.textures--
        },
        Kb = function(a) {
            a = a.target;
            a.removeEventListener("dispose", Kb);
            if (a && a.__webglTexture)
                if (m.deleteTexture(a.__webglTexture), a instanceof THREE.WebGLRenderTargetCube)
                    for (var b = 0; 6 > b; b++) m.deleteFramebuffer(a.__webglFramebuffer[b]), m.deleteRenderbuffer(a.__webglRenderbuffer[b]);
                else m.deleteFramebuffer(a.__webglFramebuffer), m.deleteRenderbuffer(a.__webglRenderbuffer);
            M.info.memory.textures--
        },
        Rb = function(a) {
            a = a.target;
            a.removeEventListener("dispose", Rb);
            Db(a)
        },
        Jb = function(a) {
            void 0 !==
                a.__webglVertexBuffer && m.deleteBuffer(a.__webglVertexBuffer);
            void 0 !== a.__webglNormalBuffer && m.deleteBuffer(a.__webglNormalBuffer);
            void 0 !== a.__webglTangentBuffer && m.deleteBuffer(a.__webglTangentBuffer);
            void 0 !== a.__webglColorBuffer && m.deleteBuffer(a.__webglColorBuffer);
            void 0 !== a.__webglUVBuffer && m.deleteBuffer(a.__webglUVBuffer);
            void 0 !== a.__webglUV2Buffer && m.deleteBuffer(a.__webglUV2Buffer);
            void 0 !== a.__webglSkinIndicesBuffer && m.deleteBuffer(a.__webglSkinIndicesBuffer);
            void 0 !== a.__webglSkinWeightsBuffer &&
                m.deleteBuffer(a.__webglSkinWeightsBuffer);
            void 0 !== a.__webglFaceBuffer && m.deleteBuffer(a.__webglFaceBuffer);
            void 0 !== a.__webglLineBuffer && m.deleteBuffer(a.__webglLineBuffer);
            void 0 !== a.__webglLineDistanceBuffer && m.deleteBuffer(a.__webglLineDistanceBuffer);
            if (void 0 !== a.__webglCustomAttributesList)
                for (var b in a.__webglCustomAttributesList) m.deleteBuffer(a.__webglCustomAttributesList[b].buffer);
            M.info.memory.geometries--
        },
        Db = function(a) {
            var b = a.program.program;
            if (void 0 !== b) {
                a.program = void 0;
                var c,
                    d, e = !1;
                a = 0;
                for (c = da.length; a < c; a++)
                    if (d = da[a], d.program === b) {
                        d.usedTimes--;
                        0 === d.usedTimes && (e = !0);
                        break
                    }
                if (!0 === e) {
                    e = [];
                    a = 0;
                    for (c = da.length; a < c; a++) d = da[a], d.program !== b && e.push(d);
                    da = e;
                    m.deleteProgram(b);
                    M.info.memory.programs--
                }
            }
        };
    this.renderBufferImmediate = function(a, b, c) {
        h();
        a.hasPositions && !a.__webglVertexBuffer && (a.__webglVertexBuffer = m.createBuffer());
        a.hasNormals && !a.__webglNormalBuffer && (a.__webglNormalBuffer = m.createBuffer());
        a.hasUvs && !a.__webglUvBuffer && (a.__webglUvBuffer = m.createBuffer());
        a.hasColors && !a.__webglColorBuffer && (a.__webglColorBuffer = m.createBuffer());
        a.hasPositions && (m.bindBuffer(m.ARRAY_BUFFER, a.__webglVertexBuffer), m.bufferData(m.ARRAY_BUFFER, a.positionArray, m.DYNAMIC_DRAW), k(b.attributes.position), m.vertexAttribPointer(b.attributes.position, 3, m.FLOAT, !1, 0, 0));
        if (a.hasNormals) {
            m.bindBuffer(m.ARRAY_BUFFER, a.__webglNormalBuffer);
            if (c.shading === THREE.FlatShading) {
                var d, e, f, g, n, p, q, r, s, t, u, v = 3 * a.count;
                for (u = 0; u < v; u += 9) t = a.normalArray, d = t[u], e = t[u + 1], f = t[u + 2], g = t[u + 3], p =
                    t[u + 4], r = t[u + 5], n = t[u + 6], q = t[u + 7], s = t[u + 8], d = (d + g + n) / 3, e = (e + p + q) / 3, f = (f + r + s) / 3, t[u] = d, t[u + 1] = e, t[u + 2] = f, t[u + 3] = d, t[u + 4] = e, t[u + 5] = f, t[u + 6] = d, t[u + 7] = e, t[u + 8] = f
            }
            m.bufferData(m.ARRAY_BUFFER, a.normalArray, m.DYNAMIC_DRAW);
            k(b.attributes.normal);
            m.vertexAttribPointer(b.attributes.normal, 3, m.FLOAT, !1, 0, 0)
        }
        a.hasUvs && c.map && (m.bindBuffer(m.ARRAY_BUFFER, a.__webglUvBuffer), m.bufferData(m.ARRAY_BUFFER, a.uvArray, m.DYNAMIC_DRAW), k(b.attributes.uv), m.vertexAttribPointer(b.attributes.uv, 2, m.FLOAT, !1, 0, 0));
        a.hasColors &&
            c.vertexColors !== THREE.NoColors && (m.bindBuffer(m.ARRAY_BUFFER, a.__webglColorBuffer), m.bufferData(m.ARRAY_BUFFER, a.colorArray, m.DYNAMIC_DRAW), k(b.attributes.color), m.vertexAttribPointer(b.attributes.color, 3, m.FLOAT, !1, 0, 0));
        l();
        m.drawArrays(m.TRIANGLES, 0, a.count);
        a.count = 0
    };
    this.renderBufferDirect = function(a, b, c, d, e, f) {
        if (!1 !== d.visible) {
            var k = G(a, b, c, d, f);
            a = k.attributes;
            b = e.attributes;
            c = !1;
            k = 16777215 * e.id + 2 * k.id + (d.wireframe ? 1 : 0);
            k !== Ca && (Ca = k, c = !0);
            c && h();
            if (f instanceof THREE.Mesh)
                if (f = b.index) {
                    var l;
                    f.array instanceof Uint32Array ? (k = m.UNSIGNED_INT, l = 4) : (k = m.UNSIGNED_SHORT, l = 2);
                    e = e.offsets;
                    if (0 === e.length) c && (g(d, a, b, 0), m.bindBuffer(m.ELEMENT_ARRAY_BUFFER, f.buffer)), m.drawElements(m.TRIANGLES, f.array.length, k, 0), M.info.render.calls++, M.info.render.vertices += f.array.length, M.info.render.faces += f.array.length / 3;
                    else {
                        c = !0;
                        for (var n = 0, p = e.length; n < p; n++) {
                            var q = e[n].index;
                            c && (g(d, a, b, q), m.bindBuffer(m.ELEMENT_ARRAY_BUFFER, f.buffer));
                            m.drawElements(m.TRIANGLES, e[n].count, k, e[n].start * l);
                            M.info.render.calls++;
                            M.info.render.vertices += e[n].count;
                            M.info.render.faces += e[n].count / 3
                        }
                    }
                } else c && g(d, a, b, 0), d = e.attributes.position, m.drawArrays(m.TRIANGLES, 0, d.array.length / 3), M.info.render.calls++, M.info.render.vertices += d.array.length / 3, M.info.render.faces += d.array.length / 9;
            else if (f instanceof THREE.PointCloud) c && g(d, a, b, 0), d = b.position, m.drawArrays(m.POINTS, 0, d.array.length / 3), M.info.render.calls++, M.info.render.points += d.array.length / 3;
            else if (f instanceof THREE.Line)
                if (k = f.type === THREE.LineStrip ? m.LINE_STRIP :
                    m.LINES, H(d.linewidth), f = b.index)
                    if (f.array instanceof Uint32Array ? (k = m.UNSIGNED_INT, l = 4) : (k = m.UNSIGNED_SHORT, l = 2), e = e.offsets, 0 === e.length) c && (g(d, a, b, 0), m.bindBuffer(m.ELEMENT_ARRAY_BUFFER, f.buffer)), m.drawElements(m.LINES, f.array.length, k, 0), M.info.render.calls++, M.info.render.vertices += f.array.length;
                    else
                        for (1 < e.length && (c = !0), n = 0, p = e.length; n < p; n++) q = e[n].index, c && (g(d, a, b, q), m.bindBuffer(m.ELEMENT_ARRAY_BUFFER, f.buffer)), m.drawElements(m.LINES, e[n].count, k, e[n].start * l), M.info.render.calls++,
                            M.info.render.vertices += e[n].count;
            else c && g(d, a, b, 0), d = b.position, m.drawArrays(k, 0, d.array.length / 3), M.info.render.calls++, M.info.render.points += d.array.length / 3
        }
    };
    this.renderBuffer = function(a, b, c, d, e, f) {
        if (!1 !== d.visible) {
            var g, n;
            c = G(a, b, c, d, f);
            b = c.attributes;
            a = !1;
            c = 16777215 * e.id + 2 * c.id + (d.wireframe ? 1 : 0);
            c !== Ca && (Ca = c, a = !0);
            a && h();
            if (!d.morphTargets && 0 <= b.position) a && (m.bindBuffer(m.ARRAY_BUFFER, e.__webglVertexBuffer), k(b.position), m.vertexAttribPointer(b.position, 3, m.FLOAT, !1, 0, 0));
            else if (f.morphTargetBase) {
                c =
                    d.program.attributes; - 1 !== f.morphTargetBase && 0 <= c.position ? (m.bindBuffer(m.ARRAY_BUFFER, e.__webglMorphTargetsBuffers[f.morphTargetBase]), k(c.position), m.vertexAttribPointer(c.position, 3, m.FLOAT, !1, 0, 0)) : 0 <= c.position && (m.bindBuffer(m.ARRAY_BUFFER, e.__webglVertexBuffer), k(c.position), m.vertexAttribPointer(c.position, 3, m.FLOAT, !1, 0, 0));
                if (f.morphTargetForcedOrder.length) {
                    var p = 0;
                    n = f.morphTargetForcedOrder;
                    for (g = f.morphTargetInfluences; p < d.numSupportedMorphTargets && p < n.length;) 0 <= c["morphTarget" + p] &&
                        (m.bindBuffer(m.ARRAY_BUFFER, e.__webglMorphTargetsBuffers[n[p]]), k(c["morphTarget" + p]), m.vertexAttribPointer(c["morphTarget" + p], 3, m.FLOAT, !1, 0, 0)), 0 <= c["morphNormal" + p] && d.morphNormals && (m.bindBuffer(m.ARRAY_BUFFER, e.__webglMorphNormalsBuffers[n[p]]), k(c["morphNormal" + p]), m.vertexAttribPointer(c["morphNormal" + p], 3, m.FLOAT, !1, 0, 0)), f.__webglMorphTargetInfluences[p] = g[n[p]], p++
                } else {
                    n = [];
                    g = f.morphTargetInfluences;
                    var r, s = g.length;
                    for (r = 0; r < s; r++) p = g[r], 0 < p && n.push([p, r]);
                    n.length > d.numSupportedMorphTargets ?
                        (n.sort(q), n.length = d.numSupportedMorphTargets) : n.length > d.numSupportedMorphNormals ? n.sort(q) : 0 === n.length && n.push([0, 0]);
                    for (p = 0; p < d.numSupportedMorphTargets;) n[p] ? (r = n[p][1], 0 <= c["morphTarget" + p] && (m.bindBuffer(m.ARRAY_BUFFER, e.__webglMorphTargetsBuffers[r]), k(c["morphTarget" + p]), m.vertexAttribPointer(c["morphTarget" + p], 3, m.FLOAT, !1, 0, 0)), 0 <= c["morphNormal" + p] && d.morphNormals && (m.bindBuffer(m.ARRAY_BUFFER, e.__webglMorphNormalsBuffers[r]), k(c["morphNormal" + p]), m.vertexAttribPointer(c["morphNormal" +
                        p], 3, m.FLOAT, !1, 0, 0)), f.__webglMorphTargetInfluences[p] = g[r]) : f.__webglMorphTargetInfluences[p] = 0, p++
                }
                null !== d.program.uniforms.morphTargetInfluences && m.uniform1fv(d.program.uniforms.morphTargetInfluences, f.__webglMorphTargetInfluences)
            }
            if (a) {
                if (e.__webglCustomAttributesList)
                    for (g = 0, n = e.__webglCustomAttributesList.length; g < n; g++) c = e.__webglCustomAttributesList[g], 0 <= b[c.buffer.belongsToAttribute] && (m.bindBuffer(m.ARRAY_BUFFER, c.buffer), k(b[c.buffer.belongsToAttribute]), m.vertexAttribPointer(b[c.buffer.belongsToAttribute],
                        c.size, m.FLOAT, !1, 0, 0));
                0 <= b.color && (0 < f.geometry.colors.length || 0 < f.geometry.faces.length ? (m.bindBuffer(m.ARRAY_BUFFER, e.__webglColorBuffer), k(b.color), m.vertexAttribPointer(b.color, 3, m.FLOAT, !1, 0, 0)) : d.defaultAttributeValues && m.vertexAttrib3fv(b.color, d.defaultAttributeValues.color));
                0 <= b.normal && (m.bindBuffer(m.ARRAY_BUFFER, e.__webglNormalBuffer), k(b.normal), m.vertexAttribPointer(b.normal, 3, m.FLOAT, !1, 0, 0));
                0 <= b.tangent && (m.bindBuffer(m.ARRAY_BUFFER, e.__webglTangentBuffer), k(b.tangent), m.vertexAttribPointer(b.tangent,
                    4, m.FLOAT, !1, 0, 0));
                0 <= b.uv && (f.geometry.faceVertexUvs[0] ? (m.bindBuffer(m.ARRAY_BUFFER, e.__webglUVBuffer), k(b.uv), m.vertexAttribPointer(b.uv, 2, m.FLOAT, !1, 0, 0)) : d.defaultAttributeValues && m.vertexAttrib2fv(b.uv, d.defaultAttributeValues.uv));
                0 <= b.uv2 && (f.geometry.faceVertexUvs[1] ? (m.bindBuffer(m.ARRAY_BUFFER, e.__webglUV2Buffer), k(b.uv2), m.vertexAttribPointer(b.uv2, 2, m.FLOAT, !1, 0, 0)) : d.defaultAttributeValues && m.vertexAttrib2fv(b.uv2, d.defaultAttributeValues.uv2));
                d.skinning && 0 <= b.skinIndex && 0 <= b.skinWeight &&
                    (m.bindBuffer(m.ARRAY_BUFFER, e.__webglSkinIndicesBuffer), k(b.skinIndex), m.vertexAttribPointer(b.skinIndex, 4, m.FLOAT, !1, 0, 0), m.bindBuffer(m.ARRAY_BUFFER, e.__webglSkinWeightsBuffer), k(b.skinWeight), m.vertexAttribPointer(b.skinWeight, 4, m.FLOAT, !1, 0, 0));
                0 <= b.lineDistance && (m.bindBuffer(m.ARRAY_BUFFER, e.__webglLineDistanceBuffer), k(b.lineDistance), m.vertexAttribPointer(b.lineDistance, 1, m.FLOAT, !1, 0, 0))
            }
            l();
            f instanceof THREE.Mesh ? (f = e.__typeArray === Uint32Array ? m.UNSIGNED_INT : m.UNSIGNED_SHORT, d.wireframe ?
                    (H(d.wireframeLinewidth), a && m.bindBuffer(m.ELEMENT_ARRAY_BUFFER, e.__webglLineBuffer), m.drawElements(m.LINES, e.__webglLineCount, f, 0)) : (a && m.bindBuffer(m.ELEMENT_ARRAY_BUFFER, e.__webglFaceBuffer), m.drawElements(m.TRIANGLES, e.__webglFaceCount, f, 0)), M.info.render.calls++, M.info.render.vertices += e.__webglFaceCount, M.info.render.faces += e.__webglFaceCount / 3) : f instanceof THREE.Line ? (f = f.type === THREE.LineStrip ? m.LINE_STRIP : m.LINES, H(d.linewidth), m.drawArrays(f, 0, e.__webglLineCount), M.info.render.calls++) :
                f instanceof THREE.PointCloud && (m.drawArrays(m.POINTS, 0, e.__webglParticleCount), M.info.render.calls++, M.info.render.points += e.__webglParticleCount)
        }
    };
    this.render = function(a, b, c, d) {
        if (!1 === b instanceof THREE.Camera) console.error("THREE.WebGLRenderer.render: camera is not an instance of THREE.Camera.");
        else {
            var e, f, g, h, k = a.__lights,
                l = a.fog;
            xa = -1;
            cb = !0;
            !0 === a.autoUpdate && a.updateMatrixWorld();
            void 0 === b.parent && b.updateMatrixWorld();
            b.matrixWorldInverse.getInverse(b.matrixWorld);
            Pb.multiplyMatrices(b.projectionMatrix,
                b.matrixWorldInverse);
            Bb.setFromMatrix(Pb);
            this.autoUpdateObjects && this.initWebGLObjects(a);
            r(this.renderPluginsPre, a, b);
            M.info.render.calls = 0;
            M.info.render.vertices = 0;
            M.info.render.faces = 0;
            M.info.render.points = 0;
            this.setRenderTarget(c);
            (this.autoClear || d) && this.clear(this.autoClearColor, this.autoClearDepth, this.autoClearStencil);
            h = a.__webglObjects;
            d = 0;
            for (e = h.length; d < e; d++)
                if (f = h[d], g = f.object, f.id = d, f.render = !1, g.visible && (!1 === g.frustumCulled || !0 === Bb.intersectsObject(g))) {
                    var n = g;
                    n._modelViewMatrix.multiplyMatrices(b.matrixWorldInverse,
                        n.matrixWorld);
                    n._normalMatrix.getNormalMatrix(n._modelViewMatrix);
                    var n = f,
                        q = n.object,
                        u = n.buffer,
                        v = q.geometry,
                        q = q.material;
                    q instanceof THREE.MeshFaceMaterial ? (q = q.materials[v instanceof THREE.BufferGeometry ? 0 : u.materialIndex], q.transparent ? (n.transparent = q, n.opaque = null) : (n.opaque = q, n.transparent = null)) : q && (q.transparent ? (n.transparent = q, n.opaque = null) : (n.opaque = q, n.transparent = null));
                    f.render = !0;
                    !0 === this.sortObjects && (null !== g.renderDepth ? f.z = g.renderDepth : (ya.setFromMatrixPosition(g.matrixWorld),
                        ya.applyProjection(Pb), f.z = ya.z))
                }
            this.sortObjects && h.sort(p);
            h = a.__webglObjectsImmediate;
            d = 0;
            for (e = h.length; d < e; d++) f = h[d], g = f.object, g.visible && (g._modelViewMatrix.multiplyMatrices(b.matrixWorldInverse, g.matrixWorld), g._normalMatrix.getNormalMatrix(g._modelViewMatrix), g = f.object.material, g.transparent ? (f.transparent = g, f.opaque = null) : (f.opaque = g, f.transparent = null));
            a.overrideMaterial ? (d = a.overrideMaterial, this.setBlending(d.blending, d.blendEquation, d.blendSrc, d.blendDst), this.setDepthTest(d.depthTest),
                this.setDepthWrite(d.depthWrite), y(d.polygonOffset, d.polygonOffsetFactor, d.polygonOffsetUnits), t(a.__webglObjects, !1, "", b, k, l, !0, d), s(a.__webglObjectsImmediate, "", b, k, l, !1, d)) : (d = null, this.setBlending(THREE.NoBlending), t(a.__webglObjects, !0, "opaque", b, k, l, !1, d), s(a.__webglObjectsImmediate, "opaque", b, k, l, !1, d), t(a.__webglObjects, !1, "transparent", b, k, l, !0, d), s(a.__webglObjectsImmediate, "transparent", b, k, l, !0, d));
            r(this.renderPluginsPost, a, b);
            c && c.generateMipmaps && c.minFilter !== THREE.NearestFilter &&
                c.minFilter !== THREE.LinearFilter && (c instanceof THREE.WebGLRenderTargetCube ? (m.bindTexture(m.TEXTURE_CUBE_MAP, c.__webglTexture), m.generateMipmap(m.TEXTURE_CUBE_MAP), m.bindTexture(m.TEXTURE_CUBE_MAP, null)) : (m.bindTexture(m.TEXTURE_2D, c.__webglTexture), m.generateMipmap(m.TEXTURE_2D), m.bindTexture(m.TEXTURE_2D, null)));
            this.setDepthTest(!0);
            this.setDepthWrite(!0)
        }
    };
    this.renderImmediateObject = function(a, b, c, d, e) {
        var f = G(a, b, c, d, e);
        Ca = -1;
        M.setMaterialFaces(d);
        e.immediateRenderCallback ? e.immediateRenderCallback(f,
            m, Bb) : e.render(function(a) {
            M.renderBufferImmediate(a, f, d)
        })
    };
    this.initWebGLObjects = function(a) {
        a.__webglObjects || (a.__webglObjects = [], a.__webglObjectsImmediate = [], a.__webglSprites = [], a.__webglFlares = []);
        for (; a.__objectsAdded.length;) n(a.__objectsAdded[0], a), a.__objectsAdded.splice(0, 1);
        for (; a.__objectsRemoved.length;) x(a.__objectsRemoved[0], a), a.__objectsRemoved.splice(0, 1);
        for (var b = 0, g = a.__webglObjects.length; b < g; b++) {
            var h = a.__webglObjects[b].object;
            void 0 === h.__webglInit && (void 0 !== h.__webglActive &&
                x(h, a), n(h, a));
            var k = h,
                l = k.geometry,
                p = void 0,
                r = void 0,
                s = void 0;
            if (l instanceof THREE.BufferGeometry) {
                var t = m.DYNAMIC_DRAW,
                    v = l.attributes,
                    A = void 0,
                    y = void 0;
                for (A in v) y = v[A], y.needsUpdate && ("index" === A ? (m.bindBuffer(m.ELEMENT_ARRAY_BUFFER, y.buffer), m.bufferData(m.ELEMENT_ARRAY_BUFFER, y.array, t)) : (m.bindBuffer(m.ARRAY_BUFFER, y.buffer), m.bufferData(m.ARRAY_BUFFER, y.array, t)), y.needsUpdate = !1)
            } else if (k instanceof THREE.Mesh) {
                for (var K = 0, C = l.geometryGroupsList.length; K < C; K++)
                    if (p = l.geometryGroupsList[K],
                        s = d(k, p), l.buffersNeedUpdate && c(p, k), r = s.attributes && w(s), l.verticesNeedUpdate || l.morphTargetsNeedUpdate || l.elementsNeedUpdate || l.uvsNeedUpdate || l.normalsNeedUpdate || l.colorsNeedUpdate || l.tangentsNeedUpdate || r) {
                        var B = p,
                            H = k,
                            M = m.DYNAMIC_DRAW,
                            G = !l.dynamic,
                            F = s;
                        if (B.__inittedArrays) {
                            var E = e(F),
                                I = F.vertexColors ? F.vertexColors : !1,
                                L = f(F),
                                P = E === THREE.SmoothShading,
                                z = void 0,
                                D = void 0,
                                Q = void 0,
                                N = void 0,
                                R = void 0,
                                S = void 0,
                                da = void 0,
                                X = void 0,
                                ba = void 0,
                                U = void 0,
                                W = void 0,
                                Y = void 0,
                                Z = void 0,
                                $ = void 0,
                                wa = void 0,
                                xa = void 0,
                                ia = void 0,
                                ca = void 0,
                                Ha = void 0,
                                ea = void 0,
                                fa = void 0,
                                Ea = void 0,
                                ha = void 0,
                                ja = void 0,
                                Ca = void 0,
                                la = void 0,
                                ma = void 0,
                                pa = void 0,
                                La = void 0,
                                Ga = void 0,
                                Ja = void 0,
                                za = void 0,
                                Da = void 0,
                                Fa = void 0,
                                oa = void 0,
                                Ka = void 0,
                                ta = void 0,
                                va = void 0,
                                Ia = void 0,
                                Pa = void 0,
                                ua = 0,
                                bb = 0,
                                Sa = 0,
                                Ta = 0,
                                Qa = 0,
                                eb = 0,
                                Ua = 0,
                                sb = 0,
                                Za = 0,
                                sa = 0,
                                Aa = 0,
                                O = 0,
                                Ra = void 0,
                                fb = B.__vertexArray,
                                cb = B.__uvArray,
                                db = B.__uv2Array,
                                ub = B.__normalArray,
                                Va = B.__tangentArray,
                                gb = B.__colorArray,
                                Wa = B.__skinIndexArray,
                                Xa = B.__skinWeightArray,
                                pb = B.__morphTargetsArrays,
                                rb = B.__morphNormalsArrays,
                                qb = B.__webglCustomAttributesList,
                                J = void 0,
                                mb = B.__faceArray,
                                vb = B.__lineArray,
                                Ma = H.geometry,
                                Bb = Ma.elementsNeedUpdate,
                                yb = Ma.uvsNeedUpdate,
                                Eb = Ma.normalsNeedUpdate,
                                Fb = Ma.tangentsNeedUpdate,
                                Hb = Ma.colorsNeedUpdate,
                                Qb = Ma.morphTargetsNeedUpdate,
                                fc = Ma.vertices,
                                ga = B.faces3,
                                hb = Ma.faces,
                                Cb = Ma.faceVertexUvs[0],
                                Db = Ma.faceVertexUvs[1],
                                gc = Ma.skinIndices,
                                Sb = Ma.skinWeights,
                                Tb = Ma.morphTargets,
                                Gb = Ma.morphNormals;
                            if (Ma.verticesNeedUpdate) {
                                z = 0;
                                for (D = ga.length; z < D; z++) N = hb[ga[z]], Y = fc[N.a], Z = fc[N.b], $ = fc[N.c], fb[bb] = Y.x,
                                    fb[bb + 1] = Y.y, fb[bb + 2] = Y.z, fb[bb + 3] = Z.x, fb[bb + 4] = Z.y, fb[bb + 5] = Z.z, fb[bb + 6] = $.x, fb[bb + 7] = $.y, fb[bb + 8] = $.z, bb += 9;
                                m.bindBuffer(m.ARRAY_BUFFER, B.__webglVertexBuffer);
                                m.bufferData(m.ARRAY_BUFFER, fb, M)
                            }
                            if (Qb)
                                for (oa = 0, Ka = Tb.length; oa < Ka; oa++) {
                                    z = Aa = 0;
                                    for (D = ga.length; z < D; z++) Ia = ga[z], N = hb[Ia], Y = Tb[oa].vertices[N.a], Z = Tb[oa].vertices[N.b], $ = Tb[oa].vertices[N.c], ta = pb[oa], ta[Aa] = Y.x, ta[Aa + 1] = Y.y, ta[Aa + 2] = Y.z, ta[Aa + 3] = Z.x, ta[Aa + 4] = Z.y, ta[Aa + 5] = Z.z, ta[Aa + 6] = $.x, ta[Aa + 7] = $.y, ta[Aa + 8] = $.z, F.morphNormals && (P ? (Pa =
                                        Gb[oa].vertexNormals[Ia], ca = Pa.a, Ha = Pa.b, ea = Pa.c) : ea = Ha = ca = Gb[oa].faceNormals[Ia], va = rb[oa], va[Aa] = ca.x, va[Aa + 1] = ca.y, va[Aa + 2] = ca.z, va[Aa + 3] = Ha.x, va[Aa + 4] = Ha.y, va[Aa + 5] = Ha.z, va[Aa + 6] = ea.x, va[Aa + 7] = ea.y, va[Aa + 8] = ea.z), Aa += 9;
                                    m.bindBuffer(m.ARRAY_BUFFER, B.__webglMorphTargetsBuffers[oa]);
                                    m.bufferData(m.ARRAY_BUFFER, pb[oa], M);
                                    F.morphNormals && (m.bindBuffer(m.ARRAY_BUFFER, B.__webglMorphNormalsBuffers[oa]), m.bufferData(m.ARRAY_BUFFER, rb[oa], M))
                                }
                            if (Sb.length) {
                                z = 0;
                                for (D = ga.length; z < D; z++) N = hb[ga[z]], ja = Sb[N.a],
                                    Ca = Sb[N.b], la = Sb[N.c], Xa[sa] = ja.x, Xa[sa + 1] = ja.y, Xa[sa + 2] = ja.z, Xa[sa + 3] = ja.w, Xa[sa + 4] = Ca.x, Xa[sa + 5] = Ca.y, Xa[sa + 6] = Ca.z, Xa[sa + 7] = Ca.w, Xa[sa + 8] = la.x, Xa[sa + 9] = la.y, Xa[sa + 10] = la.z, Xa[sa + 11] = la.w, ma = gc[N.a], pa = gc[N.b], La = gc[N.c], Wa[sa] = ma.x, Wa[sa + 1] = ma.y, Wa[sa + 2] = ma.z, Wa[sa + 3] = ma.w, Wa[sa + 4] = pa.x, Wa[sa + 5] = pa.y, Wa[sa + 6] = pa.z, Wa[sa + 7] = pa.w, Wa[sa + 8] = La.x, Wa[sa + 9] = La.y, Wa[sa + 10] = La.z, Wa[sa + 11] = La.w, sa += 12;
                                0 < sa && (m.bindBuffer(m.ARRAY_BUFFER, B.__webglSkinIndicesBuffer), m.bufferData(m.ARRAY_BUFFER, Wa, M), m.bindBuffer(m.ARRAY_BUFFER,
                                    B.__webglSkinWeightsBuffer), m.bufferData(m.ARRAY_BUFFER, Xa, M))
                            }
                            if (Hb && I) {
                                z = 0;
                                for (D = ga.length; z < D; z++) N = hb[ga[z]], da = N.vertexColors, X = N.color, 3 === da.length && I === THREE.VertexColors ? (fa = da[0], Ea = da[1], ha = da[2]) : ha = Ea = fa = X, gb[Za] = fa.r, gb[Za + 1] = fa.g, gb[Za + 2] = fa.b, gb[Za + 3] = Ea.r, gb[Za + 4] = Ea.g, gb[Za + 5] = Ea.b, gb[Za + 6] = ha.r, gb[Za + 7] = ha.g, gb[Za + 8] = ha.b, Za += 9;
                                0 < Za && (m.bindBuffer(m.ARRAY_BUFFER, B.__webglColorBuffer), m.bufferData(m.ARRAY_BUFFER, gb, M))
                            }
                            if (Fb && Ma.hasTangents) {
                                z = 0;
                                for (D = ga.length; z < D; z++) N = hb[ga[z]],
                                    ba = N.vertexTangents, wa = ba[0], xa = ba[1], ia = ba[2], Va[Ua] = wa.x, Va[Ua + 1] = wa.y, Va[Ua + 2] = wa.z, Va[Ua + 3] = wa.w, Va[Ua + 4] = xa.x, Va[Ua + 5] = xa.y, Va[Ua + 6] = xa.z, Va[Ua + 7] = xa.w, Va[Ua + 8] = ia.x, Va[Ua + 9] = ia.y, Va[Ua + 10] = ia.z, Va[Ua + 11] = ia.w, Ua += 12;
                                m.bindBuffer(m.ARRAY_BUFFER, B.__webglTangentBuffer);
                                m.bufferData(m.ARRAY_BUFFER, Va, M)
                            }
                            if (Eb && E) {
                                z = 0;
                                for (D = ga.length; z < D; z++)
                                    if (N = hb[ga[z]], R = N.vertexNormals, S = N.normal, 3 === R.length && P)
                                        for (Ga = 0; 3 > Ga; Ga++) za = R[Ga], ub[eb] = za.x, ub[eb + 1] = za.y, ub[eb + 2] = za.z, eb += 3;
                                    else
                                        for (Ga = 0; 3 > Ga; Ga++) ub[eb] =
                                            S.x, ub[eb + 1] = S.y, ub[eb + 2] = S.z, eb += 3;
                                m.bindBuffer(m.ARRAY_BUFFER, B.__webglNormalBuffer);
                                m.bufferData(m.ARRAY_BUFFER, ub, M)
                            }
                            if (yb && Cb && L) {
                                z = 0;
                                for (D = ga.length; z < D; z++)
                                    if (Q = ga[z], U = Cb[Q], void 0 !== U)
                                        for (Ga = 0; 3 > Ga; Ga++) Da = U[Ga], cb[Sa] = Da.x, cb[Sa + 1] = Da.y, Sa += 2;
                                0 < Sa && (m.bindBuffer(m.ARRAY_BUFFER, B.__webglUVBuffer), m.bufferData(m.ARRAY_BUFFER, cb, M))
                            }
                            if (yb && Db && L) {
                                z = 0;
                                for (D = ga.length; z < D; z++)
                                    if (Q = ga[z], W = Db[Q], void 0 !== W)
                                        for (Ga = 0; 3 > Ga; Ga++) Fa = W[Ga], db[Ta] = Fa.x, db[Ta + 1] = Fa.y, Ta += 2;
                                0 < Ta && (m.bindBuffer(m.ARRAY_BUFFER,
                                    B.__webglUV2Buffer), m.bufferData(m.ARRAY_BUFFER, db, M))
                            }
                            if (Bb) {
                                z = 0;
                                for (D = ga.length; z < D; z++) mb[Qa] = ua, mb[Qa + 1] = ua + 1, mb[Qa + 2] = ua + 2, Qa += 3, vb[sb] = ua, vb[sb + 1] = ua + 1, vb[sb + 2] = ua, vb[sb + 3] = ua + 2, vb[sb + 4] = ua + 1, vb[sb + 5] = ua + 2, sb += 6, ua += 3;
                                m.bindBuffer(m.ELEMENT_ARRAY_BUFFER, B.__webglFaceBuffer);
                                m.bufferData(m.ELEMENT_ARRAY_BUFFER, mb, M);
                                m.bindBuffer(m.ELEMENT_ARRAY_BUFFER, B.__webglLineBuffer);
                                m.bufferData(m.ELEMENT_ARRAY_BUFFER, vb, M)
                            }
                            if (qb)
                                for (Ga = 0, Ja = qb.length; Ga < Ja; Ga++)
                                    if (J = qb[Ga], J.__original.needsUpdate) {
                                        O =
                                            0;
                                        if (1 === J.size)
                                            if (void 0 === J.boundTo || "vertices" === J.boundTo)
                                                for (z = 0, D = ga.length; z < D; z++) N = hb[ga[z]], J.array[O] = J.value[N.a], J.array[O + 1] = J.value[N.b], J.array[O + 2] = J.value[N.c], O += 3;
                                            else {
                                                if ("faces" === J.boundTo)
                                                    for (z = 0, D = ga.length; z < D; z++) Ra = J.value[ga[z]], J.array[O] = Ra, J.array[O + 1] = Ra, J.array[O + 2] = Ra, O += 3
                                            } else if (2 === J.size)
                                            if (void 0 === J.boundTo || "vertices" === J.boundTo)
                                                for (z = 0, D = ga.length; z < D; z++) N = hb[ga[z]], Y = J.value[N.a], Z = J.value[N.b], $ = J.value[N.c], J.array[O] = Y.x, J.array[O + 1] = Y.y, J.array[O + 2] =
                                                    Z.x, J.array[O + 3] = Z.y, J.array[O + 4] = $.x, J.array[O + 5] = $.y, O += 6;
                                            else {
                                                if ("faces" === J.boundTo)
                                                    for (z = 0, D = ga.length; z < D; z++) $ = Z = Y = Ra = J.value[ga[z]], J.array[O] = Y.x, J.array[O + 1] = Y.y, J.array[O + 2] = Z.x, J.array[O + 3] = Z.y, J.array[O + 4] = $.x, J.array[O + 5] = $.y, O += 6
                                            } else if (3 === J.size) {
                                            var ra;
                                            ra = "c" === J.type ? ["r", "g", "b"] : ["x", "y", "z"];
                                            if (void 0 === J.boundTo || "vertices" === J.boundTo)
                                                for (z = 0, D = ga.length; z < D; z++) N = hb[ga[z]], Y = J.value[N.a], Z = J.value[N.b], $ = J.value[N.c], J.array[O] = Y[ra[0]], J.array[O + 1] = Y[ra[1]], J.array[O + 2] =
                                                    Y[ra[2]], J.array[O + 3] = Z[ra[0]], J.array[O + 4] = Z[ra[1]], J.array[O + 5] = Z[ra[2]], J.array[O + 6] = $[ra[0]], J.array[O + 7] = $[ra[1]], J.array[O + 8] = $[ra[2]], O += 9;
                                            else if ("faces" === J.boundTo)
                                                for (z = 0, D = ga.length; z < D; z++) $ = Z = Y = Ra = J.value[ga[z]], J.array[O] = Y[ra[0]], J.array[O + 1] = Y[ra[1]], J.array[O + 2] = Y[ra[2]], J.array[O + 3] = Z[ra[0]], J.array[O + 4] = Z[ra[1]], J.array[O + 5] = Z[ra[2]], J.array[O + 6] = $[ra[0]], J.array[O + 7] = $[ra[1]], J.array[O + 8] = $[ra[2]], O += 9;
                                            else if ("faceVertices" === J.boundTo)
                                                for (z = 0, D = ga.length; z < D; z++) Ra = J.value[ga[z]],
                                                    Y = Ra[0], Z = Ra[1], $ = Ra[2], J.array[O] = Y[ra[0]], J.array[O + 1] = Y[ra[1]], J.array[O + 2] = Y[ra[2]], J.array[O + 3] = Z[ra[0]], J.array[O + 4] = Z[ra[1]], J.array[O + 5] = Z[ra[2]], J.array[O + 6] = $[ra[0]], J.array[O + 7] = $[ra[1]], J.array[O + 8] = $[ra[2]], O += 9
                                        } else if (4 === J.size)
                                            if (void 0 === J.boundTo || "vertices" === J.boundTo)
                                                for (z = 0, D = ga.length; z < D; z++) N = hb[ga[z]], Y = J.value[N.a], Z = J.value[N.b], $ = J.value[N.c], J.array[O] = Y.x, J.array[O + 1] = Y.y, J.array[O + 2] = Y.z, J.array[O + 3] = Y.w, J.array[O + 4] = Z.x, J.array[O + 5] = Z.y, J.array[O + 6] = Z.z, J.array[O +
                                                    7] = Z.w, J.array[O + 8] = $.x, J.array[O + 9] = $.y, J.array[O + 10] = $.z, J.array[O + 11] = $.w, O += 12;
                                            else if ("faces" === J.boundTo)
                                            for (z = 0, D = ga.length; z < D; z++) $ = Z = Y = Ra = J.value[ga[z]], J.array[O] = Y.x, J.array[O + 1] = Y.y, J.array[O + 2] = Y.z, J.array[O + 3] = Y.w, J.array[O + 4] = Z.x, J.array[O + 5] = Z.y, J.array[O + 6] = Z.z, J.array[O + 7] = Z.w, J.array[O + 8] = $.x, J.array[O + 9] = $.y, J.array[O + 10] = $.z, J.array[O + 11] = $.w, O += 12;
                                        else if ("faceVertices" === J.boundTo)
                                            for (z = 0, D = ga.length; z < D; z++) Ra = J.value[ga[z]], Y = Ra[0], Z = Ra[1], $ = Ra[2], J.array[O] = Y.x, J.array[O +
                                                1] = Y.y, J.array[O + 2] = Y.z, J.array[O + 3] = Y.w, J.array[O + 4] = Z.x, J.array[O + 5] = Z.y, J.array[O + 6] = Z.z, J.array[O + 7] = Z.w, J.array[O + 8] = $.x, J.array[O + 9] = $.y, J.array[O + 10] = $.z, J.array[O + 11] = $.w, O += 12;
                                        m.bindBuffer(m.ARRAY_BUFFER, J.buffer);
                                        m.bufferData(m.ARRAY_BUFFER, J.array, M)
                                    }
                            G && (delete B.__inittedArrays, delete B.__colorArray, delete B.__normalArray, delete B.__tangentArray, delete B.__uvArray, delete B.__uv2Array, delete B.__faceArray, delete B.__vertexArray, delete B.__lineArray, delete B.__skinIndexArray, delete B.__skinWeightArray)
                        }
                    }
                l.verticesNeedUpdate = !1;
                l.morphTargetsNeedUpdate = !1;
                l.elementsNeedUpdate = !1;
                l.uvsNeedUpdate = !1;
                l.normalsNeedUpdate = !1;
                l.colorsNeedUpdate = !1;
                l.tangentsNeedUpdate = !1;
                l.buffersNeedUpdate = !1;
                s.attributes && u(s)
            } else if (k instanceof THREE.Line) {
                s = d(k, l);
                r = s.attributes && w(s);
                if (l.verticesNeedUpdate || l.colorsNeedUpdate || l.lineDistancesNeedUpdate || r) {
                    var Ya = l,
                        Ub = m.DYNAMIC_DRAW,
                        Lb = void 0,
                        Mb = void 0,
                        Nb = void 0,
                        Vb = void 0,
                        qa = void 0,
                        Wb = void 0,
                        Ib = Ya.vertices,
                        Jb = Ya.colors,
                        Kb = Ya.lineDistances,
                        Rb = Ib.length,
                        bc = Jb.length,
                        cc = Kb.length,
                        Xb = Ya.__vertexArray,
                        Yb = Ya.__colorArray,
                        lc = Ya.__lineDistanceArray,
                        dc = Ya.colorsNeedUpdate,
                        ec = Ya.lineDistancesNeedUpdate,
                        hc = Ya.__webglCustomAttributesList,
                        Zb = void 0,
                        mc = void 0,
                        Ba = void 0,
                        zb = void 0,
                        Na = void 0,
                        na = void 0;
                    if (Ya.verticesNeedUpdate) {
                        for (Lb = 0; Lb < Rb; Lb++) Vb = Ib[Lb], qa = 3 * Lb, Xb[qa] = Vb.x, Xb[qa + 1] = Vb.y, Xb[qa + 2] = Vb.z;
                        m.bindBuffer(m.ARRAY_BUFFER, Ya.__webglVertexBuffer);
                        m.bufferData(m.ARRAY_BUFFER, Xb, Ub)
                    }
                    if (dc) {
                        for (Mb = 0; Mb < bc; Mb++) Wb = Jb[Mb], qa = 3 * Mb, Yb[qa] = Wb.r, Yb[qa + 1] = Wb.g, Yb[qa + 2] = Wb.b;
                        m.bindBuffer(m.ARRAY_BUFFER, Ya.__webglColorBuffer);
                        m.bufferData(m.ARRAY_BUFFER, Yb, Ub)
                    }
                    if (ec) {
                        for (Nb = 0; Nb < cc; Nb++) lc[Nb] = Kb[Nb];
                        m.bindBuffer(m.ARRAY_BUFFER, Ya.__webglLineDistanceBuffer);
                        m.bufferData(m.ARRAY_BUFFER, lc, Ub)
                    }
                    if (hc)
                        for (Zb = 0, mc = hc.length; Zb < mc; Zb++)
                            if (na = hc[Zb], na.needsUpdate && (void 0 === na.boundTo || "vertices" === na.boundTo)) {
                                qa = 0;
                                zb = na.value.length;
                                if (1 === na.size)
                                    for (Ba = 0; Ba < zb; Ba++) na.array[Ba] = na.value[Ba];
                                else if (2 === na.size)
                                    for (Ba = 0; Ba < zb; Ba++) Na = na.value[Ba], na.array[qa] = Na.x, na.array[qa + 1] = Na.y, qa += 2;
                                else if (3 === na.size)
                                    if ("c" === na.type)
                                        for (Ba =
                                            0; Ba < zb; Ba++) Na = na.value[Ba], na.array[qa] = Na.r, na.array[qa + 1] = Na.g, na.array[qa + 2] = Na.b, qa += 3;
                                    else
                                        for (Ba = 0; Ba < zb; Ba++) Na = na.value[Ba], na.array[qa] = Na.x, na.array[qa + 1] = Na.y, na.array[qa + 2] = Na.z, qa += 3;
                                else if (4 === na.size)
                                    for (Ba = 0; Ba < zb; Ba++) Na = na.value[Ba], na.array[qa] = Na.x, na.array[qa + 1] = Na.y, na.array[qa + 2] = Na.z, na.array[qa + 3] = Na.w, qa += 4;
                                m.bindBuffer(m.ARRAY_BUFFER, na.buffer);
                                m.bufferData(m.ARRAY_BUFFER, na.array, Ub)
                            }
                }
                l.verticesNeedUpdate = !1;
                l.colorsNeedUpdate = !1;
                l.lineDistancesNeedUpdate = !1;
                s.attributes &&
                    u(s)
            } else if (k instanceof THREE.PointCloud) {
                s = d(k, l);
                r = s.attributes && w(s);
                if (l.verticesNeedUpdate || l.colorsNeedUpdate || k.sortParticles || r) {
                    var ib = l,
                        ic = m.DYNAMIC_DRAW,
                        Ob = k,
                        Oa = void 0,
                        jb = void 0,
                        kb = void 0,
                        V = void 0,
                        lb = void 0,
                        tb = void 0,
                        $b = ib.vertices,
                        jc = $b.length,
                        kc = ib.colors,
                        nc = kc.length,
                        wb = ib.__vertexArray,
                        xb = ib.__colorArray,
                        nb = ib.__sortArray,
                        oc = ib.verticesNeedUpdate,
                        pc = ib.colorsNeedUpdate,
                        ob = ib.__webglCustomAttributesList,
                        $a = void 0,
                        Ab = void 0,
                        aa = void 0,
                        ab = void 0,
                        ka = void 0,
                        T = void 0;
                    if (Ob.sortParticles) {
                        ac.copy(Pb);
                        ac.multiply(Ob.matrixWorld);
                        for (Oa = 0; Oa < jc; Oa++) kb = $b[Oa], ya.copy(kb), ya.applyProjection(ac), nb[Oa] = [ya.z, Oa];
                        nb.sort(q);
                        for (Oa = 0; Oa < jc; Oa++) kb = $b[nb[Oa][1]], V = 3 * Oa, wb[V] = kb.x, wb[V + 1] = kb.y, wb[V + 2] = kb.z;
                        for (jb = 0; jb < nc; jb++) V = 3 * jb, tb = kc[nb[jb][1]], xb[V] = tb.r, xb[V + 1] = tb.g, xb[V + 2] = tb.b;
                        if (ob)
                            for ($a = 0, Ab = ob.length; $a < Ab; $a++)
                                if (T = ob[$a], void 0 === T.boundTo || "vertices" === T.boundTo)
                                    if (V = 0, ab = T.value.length, 1 === T.size)
                                        for (aa = 0; aa < ab; aa++) lb = nb[aa][1], T.array[aa] = T.value[lb];
                                    else if (2 === T.size)
                            for (aa = 0; aa <
                                ab; aa++) lb = nb[aa][1], ka = T.value[lb], T.array[V] = ka.x, T.array[V + 1] = ka.y, V += 2;
                        else if (3 === T.size)
                            if ("c" === T.type)
                                for (aa = 0; aa < ab; aa++) lb = nb[aa][1], ka = T.value[lb], T.array[V] = ka.r, T.array[V + 1] = ka.g, T.array[V + 2] = ka.b, V += 3;
                            else
                                for (aa = 0; aa < ab; aa++) lb = nb[aa][1], ka = T.value[lb], T.array[V] = ka.x, T.array[V + 1] = ka.y, T.array[V + 2] = ka.z, V += 3;
                        else if (4 === T.size)
                            for (aa = 0; aa < ab; aa++) lb = nb[aa][1], ka = T.value[lb], T.array[V] = ka.x, T.array[V + 1] = ka.y, T.array[V + 2] = ka.z, T.array[V + 3] = ka.w, V += 4
                    } else {
                        if (oc)
                            for (Oa = 0; Oa < jc; Oa++) kb =
                                $b[Oa], V = 3 * Oa, wb[V] = kb.x, wb[V + 1] = kb.y, wb[V + 2] = kb.z;
                        if (pc)
                            for (jb = 0; jb < nc; jb++) tb = kc[jb], V = 3 * jb, xb[V] = tb.r, xb[V + 1] = tb.g, xb[V + 2] = tb.b;
                        if (ob)
                            for ($a = 0, Ab = ob.length; $a < Ab; $a++)
                                if (T = ob[$a], T.needsUpdate && (void 0 === T.boundTo || "vertices" === T.boundTo))
                                    if (ab = T.value.length, V = 0, 1 === T.size)
                                        for (aa = 0; aa < ab; aa++) T.array[aa] = T.value[aa];
                                    else if (2 === T.size)
                            for (aa = 0; aa < ab; aa++) ka = T.value[aa], T.array[V] = ka.x, T.array[V + 1] = ka.y, V += 2;
                        else if (3 === T.size)
                            if ("c" === T.type)
                                for (aa = 0; aa < ab; aa++) ka = T.value[aa], T.array[V] = ka.r,
                                    T.array[V + 1] = ka.g, T.array[V + 2] = ka.b, V += 3;
                            else
                                for (aa = 0; aa < ab; aa++) ka = T.value[aa], T.array[V] = ka.x, T.array[V + 1] = ka.y, T.array[V + 2] = ka.z, V += 3;
                        else if (4 === T.size)
                            for (aa = 0; aa < ab; aa++) ka = T.value[aa], T.array[V] = ka.x, T.array[V + 1] = ka.y, T.array[V + 2] = ka.z, T.array[V + 3] = ka.w, V += 4
                    }
                    if (oc || Ob.sortParticles) m.bindBuffer(m.ARRAY_BUFFER, ib.__webglVertexBuffer), m.bufferData(m.ARRAY_BUFFER, wb, ic);
                    if (pc || Ob.sortParticles) m.bindBuffer(m.ARRAY_BUFFER, ib.__webglColorBuffer), m.bufferData(m.ARRAY_BUFFER, xb, ic);
                    if (ob)
                        for ($a =
                            0, Ab = ob.length; $a < Ab; $a++)
                            if (T = ob[$a], T.needsUpdate || Ob.sortParticles) m.bindBuffer(m.ARRAY_BUFFER, T.buffer), m.bufferData(m.ARRAY_BUFFER, T.array, ic)
                }
                l.verticesNeedUpdate = !1;
                l.colorsNeedUpdate = !1;
                s.attributes && u(s)
            }
        }
    };
    this.initMaterial = function(a, b, c, d) {
        var e, f, g, h;
        a.addEventListener("dispose", Rb);
        var k, l, n, p;
        a instanceof THREE.MeshDepthMaterial ? p = "depth" : a instanceof THREE.MeshNormalMaterial ? p = "normal" : a instanceof THREE.MeshBasicMaterial ? p = "basic" : a instanceof THREE.MeshLambertMaterial ? p = "lambert" :
            a instanceof THREE.MeshPhongMaterial ? p = "phong" : a instanceof THREE.LineBasicMaterial ? p = "basic" : a instanceof THREE.LineDashedMaterial ? p = "dashed" : a instanceof THREE.PointCloudMaterial && (p = "particle_basic");
        p && (e = THREE.ShaderLib[p], a.uniforms = THREE.UniformsUtils.clone(e.uniforms), a.vertexShader = e.vertexShader, a.fragmentShader = e.fragmentShader);
        n = h = g = f = e = 0;
        for (var q = b.length; n < q; n++) {
            var r = b[n];
            r.onlyShadow || !1 === r.visible || (r instanceof THREE.DirectionalLight && e++, r instanceof THREE.PointLight && f++, r instanceof THREE.SpotLight && g++, r instanceof THREE.HemisphereLight && h++)
        }
        q = n = 0;
        for (r = b.length; q < r; q++) {
            var s = b[q];
            s.castShadow && (s instanceof THREE.SpotLight && n++, s instanceof THREE.DirectionalLight && !s.shadowCascade && n++)
        }
        b = n;
        Eb && d && d.skeleton && d.skeleton.useVertexTexture ? n = 1024 : (n = m.getParameter(m.MAX_VERTEX_UNIFORM_VECTORS), n = Math.floor((n - 20) / 4), void 0 !== d && d instanceof THREE.SkinnedMesh && (n = Math.min(d.skeleton.bones.length, n), n < d.skeleton.bones.length && console.warn("WebGLRenderer: too many bones - " + d.skeleton.bones.length +
            ", this GPU supports just " + n + " (try OpenGL instead of ANGLE)")));
        c = {
            precision: P,
            supportsVertexTextures: Hb,
            map: !!a.map,
            envMap: !!a.envMap,
            lightMap: !!a.lightMap,
            bumpMap: !!a.bumpMap,
            normalMap: !!a.normalMap,
            specularMap: !!a.specularMap,
            vertexColors: a.vertexColors,
            fog: c,
            useFog: a.fog,
            fogExp: c instanceof THREE.FogExp2,
            sizeAttenuation: a.sizeAttenuation,
            logarithmicDepthBuffer: ha,
            skinning: a.skinning,
            maxBones: n,
            useVertexTexture: Eb && d && d.skeleton && d.skeleton.useVertexTexture,
            morphTargets: a.morphTargets,
            morphNormals: a.morphNormals,
            maxMorphTargets: this.maxMorphTargets,
            maxMorphNormals: this.maxMorphNormals,
            maxDirLights: e,
            maxPointLights: f,
            maxSpotLights: g,
            maxHemiLights: h,
            maxShadows: b,
            shadowMapEnabled: this.shadowMapEnabled && d.receiveShadow && 0 < b,
            shadowMapType: this.shadowMapType,
            shadowMapDebug: this.shadowMapDebug,
            shadowMapCascade: this.shadowMapCascade,
            alphaTest: a.alphaTest,
            metal: a.metal,
            wrapAround: a.wrapAround,
            doubleSided: a.side === THREE.DoubleSide,
            flipSided: a.side === THREE.BackSide
        };
        d = [];
        p ? d.push(p) : (d.push(a.fragmentShader), d.push(a.vertexShader));
        for (var t in a.defines) d.push(t), d.push(a.defines[t]);
        for (l in c) d.push(l), d.push(c[l]);
        p = d.join();
        var u;
        l = 0;
        for (t = da.length; l < t; l++)
            if (d = da[l], d.code === p) {
                u = d;
                u.usedTimes++;
                break
            }
        void 0 === u && (u = new THREE.WebGLProgram(this, p, a, c), da.push(u), M.info.memory.programs = da.length);
        a.program = u;
        u = a.program.attributes;
        if (a.morphTargets)
            for (a.numSupportedMorphTargets = 0, t = "morphTarget", l = 0; l < this.maxMorphTargets; l++) p = t + l, 0 <= u[p] && a.numSupportedMorphTargets++;
        if (a.morphNormals)
            for (a.numSupportedMorphNormals =
                0, t = "morphNormal", l = 0; l < this.maxMorphNormals; l++) p = t + l, 0 <= u[p] && a.numSupportedMorphNormals++;
        a.uniformsList = [];
        for (k in a.uniforms) a.uniformsList.push([a.uniforms[k], k])
    };
    this.setFaceCulling = function(a, b) {
        a === THREE.CullFaceNone ? m.disable(m.CULL_FACE) : (b === THREE.FrontFaceDirectionCW ? m.frontFace(m.CW) : m.frontFace(m.CCW), a === THREE.CullFaceBack ? m.cullFace(m.BACK) : a === THREE.CullFaceFront ? m.cullFace(m.FRONT) : m.cullFace(m.FRONT_AND_BACK), m.enable(m.CULL_FACE))
    };
    this.setMaterialFaces = function(a) {
        var b = a.side ===
            THREE.DoubleSide;
        a = a.side === THREE.BackSide;
        ba !== b && (b ? m.disable(m.CULL_FACE) : m.enable(m.CULL_FACE), ba = b);
        La !== a && (a ? m.frontFace(m.CW) : m.frontFace(m.CCW), La = a)
    };
    this.setDepthTest = function(a) {
        ja !== a && (a ? m.enable(m.DEPTH_TEST) : m.disable(m.DEPTH_TEST), ja = a)
    };
    this.setDepthWrite = function(a) {
        za !== a && (m.depthMask(a), za = a)
    };
    this.setBlending = function(a, b, c, d) {
        a !== Pa && (a === THREE.NoBlending ? m.disable(m.BLEND) : a === THREE.AdditiveBlending ? (m.enable(m.BLEND), m.blendEquation(m.FUNC_ADD), m.blendFunc(m.SRC_ALPHA, m.ONE)) :
            a === THREE.SubtractiveBlending ? (m.enable(m.BLEND), m.blendEquation(m.FUNC_ADD), m.blendFunc(m.ZERO, m.ONE_MINUS_SRC_COLOR)) : a === THREE.MultiplyBlending ? (m.enable(m.BLEND), m.blendEquation(m.FUNC_ADD), m.blendFunc(m.ZERO, m.SRC_COLOR)) : a === THREE.CustomBlending ? m.enable(m.BLEND) : (m.enable(m.BLEND), m.blendEquationSeparate(m.FUNC_ADD, m.FUNC_ADD), m.blendFuncSeparate(m.SRC_ALPHA, m.ONE_MINUS_SRC_ALPHA, m.ONE, m.ONE_MINUS_SRC_ALPHA)), Pa = a);
        if (a === THREE.CustomBlending) {
            if (b !== Sa && (m.blendEquation(L(b)), Sa = b), c !== Ta ||
                d !== Ja) m.blendFunc(L(c), L(d)), Ta = c, Ja = d
        } else Ja = Ta = Sa = null
    };
    this.setTexture = function(a, b) {
        if (a.needsUpdate) {
            a.__webglInit || (a.__webglInit = !0, a.addEventListener("dispose", Fb), a.__webglTexture = m.createTexture(), M.info.memory.textures++);
            m.activeTexture(m.TEXTURE0 + b);
            m.bindTexture(m.TEXTURE_2D, a.__webglTexture);
            m.pixelStorei(m.UNPACK_FLIP_Y_WEBGL, a.flipY);
            m.pixelStorei(m.UNPACK_PREMULTIPLY_ALPHA_WEBGL, a.premultiplyAlpha);
            m.pixelStorei(m.UNPACK_ALIGNMENT, a.unpackAlignment);
            var c = a.image,
                d = THREE.Math.isPowerOfTwo(c.width) &&
                THREE.Math.isPowerOfTwo(c.height),
                e = L(a.format),
                f = L(a.type);
            Q(m.TEXTURE_2D, a, d);
            var g = a.mipmaps;
            if (a instanceof THREE.DataTexture)
                if (0 < g.length && d) {
                    for (var h = 0, k = g.length; h < k; h++) c = g[h], m.texImage2D(m.TEXTURE_2D, h, e, c.width, c.height, 0, e, f, c.data);
                    a.generateMipmaps = !1
                } else m.texImage2D(m.TEXTURE_2D, 0, e, c.width, c.height, 0, e, f, c.data);
            else if (a instanceof THREE.CompressedTexture)
                for (h = 0, k = g.length; h < k; h++) c = g[h], a.format !== THREE.RGBAFormat ? m.compressedTexImage2D(m.TEXTURE_2D, h, e, c.width, c.height, 0, c.data) :
                    m.texImage2D(m.TEXTURE_2D, h, e, c.width, c.height, 0, e, f, c.data);
            else if (0 < g.length && d) {
                h = 0;
                for (k = g.length; h < k; h++) c = g[h], m.texImage2D(m.TEXTURE_2D, h, e, e, f, c);
                a.generateMipmaps = !1
            } else m.texImage2D(m.TEXTURE_2D, 0, e, e, f, a.image);
            a.generateMipmaps && d && m.generateMipmap(m.TEXTURE_2D);
            a.needsUpdate = !1;
            if (a.onUpdate) a.onUpdate()
        } else m.activeTexture(m.TEXTURE0 + b), m.bindTexture(m.TEXTURE_2D, a.__webglTexture)
    };
    this.setRenderTarget = function(a) {
        var b = a instanceof THREE.WebGLRenderTargetCube;
        if (a && !a.__webglFramebuffer) {
            void 0 ===
                a.depthBuffer && (a.depthBuffer = !0);
            void 0 === a.stencilBuffer && (a.stencilBuffer = !0);
            a.addEventListener("dispose", Kb);
            a.__webglTexture = m.createTexture();
            M.info.memory.textures++;
            var c = THREE.Math.isPowerOfTwo(a.width) && THREE.Math.isPowerOfTwo(a.height),
                d = L(a.format),
                e = L(a.type);
            if (b) {
                a.__webglFramebuffer = [];
                a.__webglRenderbuffer = [];
                m.bindTexture(m.TEXTURE_CUBE_MAP, a.__webglTexture);
                Q(m.TEXTURE_CUBE_MAP, a, c);
                for (var f = 0; 6 > f; f++) {
                    a.__webglFramebuffer[f] = m.createFramebuffer();
                    a.__webglRenderbuffer[f] = m.createRenderbuffer();
                    m.texImage2D(m.TEXTURE_CUBE_MAP_POSITIVE_X + f, 0, d, a.width, a.height, 0, d, e, null);
                    var g = a,
                        h = m.TEXTURE_CUBE_MAP_POSITIVE_X + f;
                    m.bindFramebuffer(m.FRAMEBUFFER, a.__webglFramebuffer[f]);
                    m.framebufferTexture2D(m.FRAMEBUFFER, m.COLOR_ATTACHMENT0, h, g.__webglTexture, 0);
                    z(a.__webglRenderbuffer[f], a)
                }
                c && m.generateMipmap(m.TEXTURE_CUBE_MAP)
            } else a.__webglFramebuffer = m.createFramebuffer(), a.__webglRenderbuffer = a.shareDepthFrom ? a.shareDepthFrom.__webglRenderbuffer : m.createRenderbuffer(), m.bindTexture(m.TEXTURE_2D, a.__webglTexture),
                Q(m.TEXTURE_2D, a, c), m.texImage2D(m.TEXTURE_2D, 0, d, a.width, a.height, 0, d, e, null), d = m.TEXTURE_2D, m.bindFramebuffer(m.FRAMEBUFFER, a.__webglFramebuffer), m.framebufferTexture2D(m.FRAMEBUFFER, m.COLOR_ATTACHMENT0, d, a.__webglTexture, 0), a.shareDepthFrom ? a.depthBuffer && !a.stencilBuffer ? m.framebufferRenderbuffer(m.FRAMEBUFFER, m.DEPTH_ATTACHMENT, m.RENDERBUFFER, a.__webglRenderbuffer) : a.depthBuffer && a.stencilBuffer && m.framebufferRenderbuffer(m.FRAMEBUFFER, m.DEPTH_STENCIL_ATTACHMENT, m.RENDERBUFFER, a.__webglRenderbuffer) :
                z(a.__webglRenderbuffer, a), c && m.generateMipmap(m.TEXTURE_2D);
            b ? m.bindTexture(m.TEXTURE_CUBE_MAP, null) : m.bindTexture(m.TEXTURE_2D, null);
            m.bindRenderbuffer(m.RENDERBUFFER, null);
            m.bindFramebuffer(m.FRAMEBUFFER, null)
        }
        a ? (b = b ? a.__webglFramebuffer[a.activeCubeFace] : a.__webglFramebuffer, c = a.width, a = a.height, e = d = 0) : (b = null, c = Fa, a = ea, d = Da, e = Ka);
        b !== ia && (m.bindFramebuffer(m.FRAMEBUFFER, b), m.viewport(d, e, c, a), ia = b);
        va = c;
        Ia = a
    };
    this.shadowMapPlugin = new THREE.ShadowMapPlugin;
    this.addPrePlugin(this.shadowMapPlugin);
    this.addPostPlugin(new THREE.SpritePlugin);
    this.addPostPlugin(new THREE.LensFlarePlugin)
};
THREE.WebGLRenderTarget = function(a, b, c) {
    this.width = a;
    this.height = b;
    c = c || {};
    this.wrapS = void 0 !== c.wrapS ? c.wrapS : THREE.ClampToEdgeWrapping;
    this.wrapT = void 0 !== c.wrapT ? c.wrapT : THREE.ClampToEdgeWrapping;
    this.magFilter = void 0 !== c.magFilter ? c.magFilter : THREE.LinearFilter;
    this.minFilter = void 0 !== c.minFilter ? c.minFilter : THREE.LinearMipMapLinearFilter;
    this.anisotropy = void 0 !== c.anisotropy ? c.anisotropy : 1;
    this.offset = new THREE.Vector2(0, 0);
    this.repeat = new THREE.Vector2(1, 1);
    this.format = void 0 !== c.format ? c.format :
        THREE.RGBAFormat;
    this.type = void 0 !== c.type ? c.type : THREE.UnsignedByteType;
    this.depthBuffer = void 0 !== c.depthBuffer ? c.depthBuffer : !0;
    this.stencilBuffer = void 0 !== c.stencilBuffer ? c.stencilBuffer : !0;
    this.generateMipmaps = !0;
    this.shareDepthFrom = null
};
THREE.WebGLRenderTarget.prototype = {
    constructor: THREE.WebGLRenderTarget,
    setSize: function(a, b) {
        this.width = a;
        this.height = b
    },
    clone: function() {
        var a = new THREE.WebGLRenderTarget(this.width, this.height);
        a.wrapS = this.wrapS;
        a.wrapT = this.wrapT;
        a.magFilter = this.magFilter;
        a.minFilter = this.minFilter;
        a.anisotropy = this.anisotropy;
        a.offset.copy(this.offset);
        a.repeat.copy(this.repeat);
        a.format = this.format;
        a.type = this.type;
        a.depthBuffer = this.depthBuffer;
        a.stencilBuffer = this.stencilBuffer;
        a.generateMipmaps = this.generateMipmaps;
        a.shareDepthFrom = this.shareDepthFrom;
        return a
    },
    dispose: function() {
        this.dispatchEvent({
            type: "dispose"
        })
    }
};
THREE.EventDispatcher.prototype.apply(THREE.WebGLRenderTarget.prototype);
THREE.WebGLRenderTargetCube = function(a, b, c) {
    THREE.WebGLRenderTarget.call(this, a, b, c);
    this.activeCubeFace = 0
};
THREE.WebGLRenderTargetCube.prototype = Object.create(THREE.WebGLRenderTarget.prototype);
THREE.WebGLProgram = function() {
    var a = 0;
    return function(b, c, d, e) {
        var f = b.context,
            g = d.fragmentShader,
            h = d.vertexShader,
            k = d.uniforms,
            l = d.attributes,
            p = d.defines,
            q = d.index0AttributeName;
        void 0 === q && !0 === e.morphTargets && (q = "position");
        var r = "SHADOWMAP_TYPE_BASIC";
        e.shadowMapType === THREE.PCFShadowMap ? r = "SHADOWMAP_TYPE_PCF" : e.shadowMapType === THREE.PCFSoftShadowMap && (r = "SHADOWMAP_TYPE_PCF_SOFT");
        var t, s;
        t = [];
        for (var n in p) s = p[n], !1 !== s && (s = "#define " + n + " " + s, t.push(s));
        t = t.join("\n");
        p = f.createProgram();
        d instanceof
        THREE.RawShaderMaterial ? b = d = "" : (d = ["precision " + e.precision + " float;", "precision " + e.precision + " int;", t, e.supportsVertexTextures ? "#define VERTEX_TEXTURES" : "", b.gammaInput ? "#define GAMMA_INPUT" : "", b.gammaOutput ? "#define GAMMA_OUTPUT" : "", "#define MAX_DIR_LIGHTS " + e.maxDirLights, "#define MAX_POINT_LIGHTS " + e.maxPointLights, "#define MAX_SPOT_LIGHTS " + e.maxSpotLights, "#define MAX_HEMI_LIGHTS " + e.maxHemiLights, "#define MAX_SHADOWS " + e.maxShadows, "#define MAX_BONES " + e.maxBones, e.map ? "#define USE_MAP" :
                "", e.envMap ? "#define USE_ENVMAP" : "", e.lightMap ? "#define USE_LIGHTMAP" : "", e.bumpMap ? "#define USE_BUMPMAP" : "", e.normalMap ? "#define USE_NORMALMAP" : "", e.specularMap ? "#define USE_SPECULARMAP" : "", e.vertexColors ? "#define USE_COLOR" : "", e.skinning ? "#define USE_SKINNING" : "", e.useVertexTexture ? "#define BONE_TEXTURE" : "", e.morphTargets ? "#define USE_MORPHTARGETS" : "", e.morphNormals ? "#define USE_MORPHNORMALS" : "", e.wrapAround ? "#define WRAP_AROUND" : "", e.doubleSided ? "#define DOUBLE_SIDED" : "", e.flipSided ? "#define FLIP_SIDED" :
                "", e.shadowMapEnabled ? "#define USE_SHADOWMAP" : "", e.shadowMapEnabled ? "#define " + r : "", e.shadowMapDebug ? "#define SHADOWMAP_DEBUG" : "", e.shadowMapCascade ? "#define SHADOWMAP_CASCADE" : "", e.sizeAttenuation ? "#define USE_SIZEATTENUATION" : "", e.logarithmicDepthBuffer ? "#define USE_LOGDEPTHBUF" : "", "uniform mat4 modelMatrix;\nuniform mat4 modelViewMatrix;\nuniform mat4 projectionMatrix;\nuniform mat4 viewMatrix;\nuniform mat3 normalMatrix;\nuniform vec3 cameraPosition;\nattribute vec3 position;\nattribute vec3 normal;\nattribute vec2 uv;\nattribute vec2 uv2;\n#ifdef USE_COLOR\n\tattribute vec3 color;\n#endif\n#ifdef USE_MORPHTARGETS\n\tattribute vec3 morphTarget0;\n\tattribute vec3 morphTarget1;\n\tattribute vec3 morphTarget2;\n\tattribute vec3 morphTarget3;\n\t#ifdef USE_MORPHNORMALS\n\t\tattribute vec3 morphNormal0;\n\t\tattribute vec3 morphNormal1;\n\t\tattribute vec3 morphNormal2;\n\t\tattribute vec3 morphNormal3;\n\t#else\n\t\tattribute vec3 morphTarget4;\n\t\tattribute vec3 morphTarget5;\n\t\tattribute vec3 morphTarget6;\n\t\tattribute vec3 morphTarget7;\n\t#endif\n#endif\n#ifdef USE_SKINNING\n\tattribute vec4 skinIndex;\n\tattribute vec4 skinWeight;\n#endif\n"
            ].join("\n"),
            b = ["precision " + e.precision + " float;", "precision " + e.precision + " int;", e.bumpMap || e.normalMap ? "#extension GL_OES_standard_derivatives : enable" : "", t, "#define MAX_DIR_LIGHTS " + e.maxDirLights, "#define MAX_POINT_LIGHTS " + e.maxPointLights, "#define MAX_SPOT_LIGHTS " + e.maxSpotLights, "#define MAX_HEMI_LIGHTS " + e.maxHemiLights, "#define MAX_SHADOWS " + e.maxShadows, e.alphaTest ? "#define ALPHATEST " + e.alphaTest : "", b.gammaInput ? "#define GAMMA_INPUT" : "", b.gammaOutput ? "#define GAMMA_OUTPUT" : "", e.useFog && e.fog ? "#define USE_FOG" :
                "", e.useFog && e.fogExp ? "#define FOG_EXP2" : "", e.map ? "#define USE_MAP" : "", e.envMap ? "#define USE_ENVMAP" : "", e.lightMap ? "#define USE_LIGHTMAP" : "", e.bumpMap ? "#define USE_BUMPMAP" : "", e.normalMap ? "#define USE_NORMALMAP" : "", e.specularMap ? "#define USE_SPECULARMAP" : "", e.vertexColors ? "#define USE_COLOR" : "", e.metal ? "#define METAL" : "", e.wrapAround ? "#define WRAP_AROUND" : "", e.doubleSided ? "#define DOUBLE_SIDED" : "", e.flipSided ? "#define FLIP_SIDED" : "", e.shadowMapEnabled ? "#define USE_SHADOWMAP" : "", e.shadowMapEnabled ?
                "#define " + r : "", e.shadowMapDebug ? "#define SHADOWMAP_DEBUG" : "", e.shadowMapCascade ? "#define SHADOWMAP_CASCADE" : "", e.logarithmicDepthBuffer ? "#define USE_LOGDEPTHBUF" : "", "uniform mat4 viewMatrix;\nuniform vec3 cameraPosition;\n"
            ].join("\n"));
        h = new THREE.WebGLShader(f, f.VERTEX_SHADER, d + h);
        g = new THREE.WebGLShader(f, f.FRAGMENT_SHADER, b + g);
        f.attachShader(p, h);
        f.attachShader(p, g);
        void 0 !== q && f.bindAttribLocation(p, 0, q);
        f.linkProgram(p);
        !1 === f.getProgramParameter(p, f.LINK_STATUS) && (console.error("THREE.WebGLProgram: Could not initialise shader."),
            console.error("gl.VALIDATE_STATUS", f.getProgramParameter(p, f.VALIDATE_STATUS)), console.error("gl.getError()", f.getError()));
        "" !== f.getProgramInfoLog(p) && console.warn("THREE.WebGLProgram: gl.getProgramInfoLog()", f.getProgramInfoLog(p));
        f.deleteShader(h);
        f.deleteShader(g);
        q = "viewMatrix modelViewMatrix projectionMatrix normalMatrix modelMatrix cameraPosition morphTargetInfluences".split(" ");
        e.useVertexTexture ? (q.push("boneTexture"), q.push("boneTextureWidth"), q.push("boneTextureHeight")) : q.push("boneGlobalMatrices");
        e.logarithmicDepthBuffer && q.push("logDepthBufFC");
        for (var v in k) q.push(v);
        k = q;
        v = {};
        q = 0;
        for (b = k.length; q < b; q++) r = k[q], v[r] = f.getUniformLocation(p, r);
        this.uniforms = v;
        q = "position normal uv uv2 tangent color skinIndex skinWeight lineDistance".split(" ");
        for (k = 0; k < e.maxMorphTargets; k++) q.push("morphTarget" + k);
        for (k = 0; k < e.maxMorphNormals; k++) q.push("morphNormal" + k);
        for (var w in l) q.push(w);
        e = q;
        l = {};
        w = 0;
        for (k = e.length; w < k; w++) v = e[w], l[v] = f.getAttribLocation(p, v);
        this.attributes = l;
        this.id = a++;
        this.code =
            c;
        this.usedTimes = 1;
        this.program = p;
        this.vertexShader = h;
        this.fragmentShader = g;
        return this
    }
}();
THREE.WebGLShader = function() {
    var a = function(a) {
        a = a.split("\n");
        for (var c = 0; c < a.length; c++) a[c] = c + 1 + ": " + a[c];
        return a.join("\n")
    };
    return function(b, c, d) {
        c = b.createShader(c);
        b.shaderSource(c, d);
        b.compileShader(c);
        !1 === b.getShaderParameter(c, b.COMPILE_STATUS) && console.error("THREE.WebGLShader: Shader couldn't compile.");
        "" !== b.getShaderInfoLog(c) && (console.warn("THREE.WebGLShader: gl.getShaderInfoLog()", b.getShaderInfoLog(c)), console.warn(a(d)));
        return c
    }
}();
THREE.RenderableVertex = function() {
    this.position = new THREE.Vector3;
    this.positionWorld = new THREE.Vector3;
    this.positionScreen = new THREE.Vector4;
    this.visible = !0
};
THREE.RenderableVertex.prototype.copy = function(a) {
    this.positionWorld.copy(a.positionWorld);
    this.positionScreen.copy(a.positionScreen)
};
THREE.RenderableFace = function() {
    this.id = 0;
    this.v1 = new THREE.RenderableVertex;
    this.v2 = new THREE.RenderableVertex;
    this.v3 = new THREE.RenderableVertex;
    this.normalModel = new THREE.Vector3;
    this.vertexNormalsModel = [new THREE.Vector3, new THREE.Vector3, new THREE.Vector3];
    this.vertexNormalsLength = 0;
    this.color = new THREE.Color;
    this.material = null;
    this.uvs = [new THREE.Vector2, new THREE.Vector2, new THREE.Vector2];
    this.z = 0
};
THREE.RenderableObject = function() {
    this.id = 0;
    this.object = null;
    this.z = 0
};
THREE.RenderableSprite = function() {
    this.id = 0;
    this.object = null;
    this.rotation = this.z = this.y = this.x = 0;
    this.scale = new THREE.Vector2;
    this.material = null
};
THREE.RenderableLine = function() {
    this.id = 0;
    this.v1 = new THREE.RenderableVertex;
    this.v2 = new THREE.RenderableVertex;
    this.vertexColors = [new THREE.Color, new THREE.Color];
    this.material = null;
    this.z = 0
};
THREE.GeometryUtils = {
    merge: function(a, b, c) {
        console.warn("THREE.GeometryUtils: .merge() has been moved to Geometry. Use geometry.merge( geometry2, matrix, materialIndexOffset ) instead.");
        var d;
        b instanceof THREE.Mesh && (b.matrixAutoUpdate && b.updateMatrix(), d = b.matrix, b = b.geometry);
        a.merge(b, d, c)
    },
    center: function(a) {
        console.warn("THREE.GeometryUtils: .center() has been moved to Geometry. Use geometry.center() instead.");
        return a.center()
    }
};
THREE.ImageUtils = {
    crossOrigin: void 0,
    loadTexture: function(a, b, c, d) {
        var e = new THREE.ImageLoader;
        e.crossOrigin = this.crossOrigin;
        var f = new THREE.Texture(void 0, b);
        e.load(a, function(a) {
            f.image = a;
            f.needsUpdate = !0;
            c && c(f)
        }, void 0, function(a) {
            d && d(a)
        });
        f.sourceFile = a;
        return f
    },
    loadTextureCube: function(a, b, c, d) {
        var e = new THREE.ImageLoader;
        e.crossOrigin = this.crossOrigin;
        var f = new THREE.CubeTexture([], b);
        f.flipY = !1;
        var g = 0;
        b = function(b) {
            e.load(a[b], function(a) {
                f.images[b] = a;
                g += 1;
                6 === g && (f.needsUpdate = !0, c &&
                    c(f))
            })
        };
        d = 0;
        for (var h = a.length; d < h; ++d) b(d);
        return f
    },
    loadCompressedTexture: function() {
        console.error("THREE.ImageUtils.loadCompressedTexture has been removed. Use THREE.DDSLoader instead.")
    },
    loadCompressedTextureCube: function() {
        console.error("THREE.ImageUtils.loadCompressedTextureCube has been removed. Use THREE.DDSLoader instead.")
    },
    getNormalMap: function(a, b) {
        var c = function(a) {
            var b = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
            return [a[0] / b, a[1] / b, a[2] / b]
        };
        b |= 1;
        var d = a.width,
            e = a.height,
            f = document.createElement("canvas");
        f.width = d;
        f.height = e;
        var g = f.getContext("2d");
        g.drawImage(a, 0, 0);
        for (var h = g.getImageData(0, 0, d, e).data, k = g.createImageData(d, e), l = k.data, p = 0; p < d; p++)
            for (var q = 0; q < e; q++) {
                var r = 0 > q - 1 ? 0 : q - 1,
                    t = q + 1 > e - 1 ? e - 1 : q + 1,
                    s = 0 > p - 1 ? 0 : p - 1,
                    n = p + 1 > d - 1 ? d - 1 : p + 1,
                    v = [],
                    w = [0, 0, h[4 * (q * d + p)] / 255 * b];
                v.push([-1, 0, h[4 * (q * d + s)] / 255 * b]);
                v.push([-1, -1, h[4 * (r * d + s)] / 255 * b]);
                v.push([0, -1, h[4 * (r * d + p)] / 255 * b]);
                v.push([1, -1, h[4 * (r * d + n)] / 255 * b]);
                v.push([1, 0, h[4 * (q * d + n)] / 255 * b]);
                v.push([1, 1, h[4 * (t * d + n)] / 255 * b]);
                v.push([0, 1, h[4 * (t * d + p)] / 255 *
                    b
                ]);
                v.push([-1, 1, h[4 * (t * d + s)] / 255 * b]);
                r = [];
                s = v.length;
                for (t = 0; t < s; t++) {
                    var n = v[t],
                        u = v[(t + 1) % s],
                        n = [n[0] - w[0], n[1] - w[1], n[2] - w[2]],
                        u = [u[0] - w[0], u[1] - w[1], u[2] - w[2]];
                    r.push(c([n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]]))
                }
                v = [0, 0, 0];
                for (t = 0; t < r.length; t++) v[0] += r[t][0], v[1] += r[t][1], v[2] += r[t][2];
                v[0] /= r.length;
                v[1] /= r.length;
                v[2] /= r.length;
                w = 4 * (q * d + p);
                l[w] = (v[0] + 1) / 2 * 255 | 0;
                l[w + 1] = (v[1] + 1) / 2 * 255 | 0;
                l[w + 2] = 255 * v[2] | 0;
                l[w + 3] = 255
            }
        g.putImageData(k, 0, 0);
        return f
    },
    generateDataTexture: function(a,
        b, c) {
        var d = a * b,
            e = new Uint8Array(3 * d),
            f = Math.floor(255 * c.r),
            g = Math.floor(255 * c.g);
        c = Math.floor(255 * c.b);
        for (var h = 0; h < d; h++) e[3 * h] = f, e[3 * h + 1] = g, e[3 * h + 2] = c;
        a = new THREE.DataTexture(e, a, b, THREE.RGBFormat);
        a.needsUpdate = !0;
        return a
    }
};
THREE.SceneUtils = {
    createMultiMaterialObject: function(a, b) {
        for (var c = new THREE.Object3D, d = 0, e = b.length; d < e; d++) c.add(new THREE.Mesh(a, b[d]));
        return c
    },
    detach: function(a, b, c) {
        a.applyMatrix(b.matrixWorld);
        b.remove(a);
        c.add(a)
    },
    attach: function(a, b, c) {
        var d = new THREE.Matrix4;
        d.getInverse(c.matrixWorld);
        a.applyMatrix(d);
        b.remove(a);
        c.add(a)
    }
};
THREE.FontUtils = {
    faces: {},
    face: "helvetiker",
    weight: "normal",
    style: "normal",
    size: 150,
    divisions: 10,
    getFace: function() {
        return this.faces[this.face][this.weight][this.style]
    },
    loadFace: function(a) {
        var b = a.familyName.toLowerCase();
        this.faces[b] = this.faces[b] || {};
        this.faces[b][a.cssFontWeight] = this.faces[b][a.cssFontWeight] || {};
        this.faces[b][a.cssFontWeight][a.cssFontStyle] = a;
        return this.faces[b][a.cssFontWeight][a.cssFontStyle] = a
    },
    drawText: function(a) {
        var b = this.getFace(),
            c = this.size / b.resolution,
            d = 0,
            e =
            String(a).split(""),
            f = e.length,
            g = [];
        for (a = 0; a < f; a++) {
            var h = new THREE.Path,
                h = this.extractGlyphPoints(e[a], b, c, d, h),
                d = d + h.offset;
            g.push(h.path)
        }
        return {
            paths: g,
            offset: d / 2
        }
    },
    extractGlyphPoints: function(a, b, c, d, e) {
        var f = [],
            g, h, k, l, p, q, r, t, s, n, v, w = b.glyphs[a] || b.glyphs["?"];
        if (w) {
            if (w.o)
                for (b = w._cachedOutline || (w._cachedOutline = w.o.split(" ")), l = b.length, a = 0; a < l;) switch (k = b[a++], k) {
                    case "m":
                        k = b[a++] * c + d;
                        p = b[a++] * c;
                        e.moveTo(k, p);
                        break;
                    case "l":
                        k = b[a++] * c + d;
                        p = b[a++] * c;
                        e.lineTo(k, p);
                        break;
                    case "q":
                        k = b[a++] *
                            c + d;
                        p = b[a++] * c;
                        t = b[a++] * c + d;
                        s = b[a++] * c;
                        e.quadraticCurveTo(t, s, k, p);
                        if (g = f[f.length - 1])
                            for (q = g.x, r = g.y, g = 1, h = this.divisions; g <= h; g++) {
                                var u = g / h;
                                THREE.Shape.Utils.b2(u, q, t, k);
                                THREE.Shape.Utils.b2(u, r, s, p)
                            }
                        break;
                    case "b":
                        if (k = b[a++] * c + d, p = b[a++] * c, t = b[a++] * c + d, s = b[a++] * c, n = b[a++] * c + d, v = b[a++] * c, e.bezierCurveTo(t, s, n, v, k, p), g = f[f.length - 1])
                            for (q = g.x, r = g.y, g = 1, h = this.divisions; g <= h; g++) u = g / h, THREE.Shape.Utils.b3(u, q, t, n, k), THREE.Shape.Utils.b3(u, r, s, v, p)
                }
            return {
                offset: w.ha * c,
                path: e
            }
        }
    }
};
THREE.FontUtils.generateShapes = function(a, b) {
    b = b || {};
    var c = void 0 !== b.curveSegments ? b.curveSegments : 4,
        d = void 0 !== b.font ? b.font : "helvetiker",
        e = void 0 !== b.weight ? b.weight : "normal",
        f = void 0 !== b.style ? b.style : "normal";
    THREE.FontUtils.size = void 0 !== b.size ? b.size : 100;
    THREE.FontUtils.divisions = c;
    THREE.FontUtils.face = d;
    THREE.FontUtils.weight = e;
    THREE.FontUtils.style = f;
    c = THREE.FontUtils.drawText(a).paths;
    d = [];
    e = 0;
    for (f = c.length; e < f; e++) Array.prototype.push.apply(d, c[e].toShapes());
    return d
};
(function(a) {
    var b = function(a) {
        for (var b = a.length, e = 0, f = b - 1, g = 0; g < b; f = g++) e += a[f].x * a[g].y - a[g].x * a[f].y;
        return 0.5 * e
    };
    a.Triangulate = function(a, d) {
        var e = a.length;
        if (3 > e) return null;
        var f = [],
            g = [],
            h = [],
            k, l, p;
        if (0 < b(a))
            for (l = 0; l < e; l++) g[l] = l;
        else
            for (l = 0; l < e; l++) g[l] = e - 1 - l;
        var q = 2 * e;
        for (l = e - 1; 2 < e;) {
            if (0 >= q--) {
                console.log("Warning, unable to triangulate polygon!");
                break
            }
            k = l;
            e <= k && (k = 0);
            l = k + 1;
            e <= l && (l = 0);
            p = l + 1;
            e <= p && (p = 0);
            var r;
            a: {
                var t = r = void 0,
                    s = void 0,
                    n = void 0,
                    v = void 0,
                    w = void 0,
                    u = void 0,
                    x = void 0,
                    K =
                    void 0,
                    t = a[g[k]].x,
                    s = a[g[k]].y,
                    n = a[g[l]].x,
                    v = a[g[l]].y,
                    w = a[g[p]].x,
                    u = a[g[p]].y;
                if (1E-10 > (n - t) * (u - s) - (v - s) * (w - t)) r = !1;
                else {
                    var A = void 0,
                        G = void 0,
                        B = void 0,
                        C = void 0,
                        E = void 0,
                        H = void 0,
                        y = void 0,
                        Q = void 0,
                        z = void 0,
                        R = void 0,
                        z = Q = y = K = x = void 0,
                        A = w - n,
                        G = u - v,
                        B = t - w,
                        C = s - u,
                        E = n - t,
                        H = v - s;
                    for (r = 0; r < e; r++)
                        if (x = a[g[r]].x, K = a[g[r]].y, !(x === t && K === s || x === n && K === v || x === w && K === u) && (y = x - t, Q = K - s, z = x - n, R = K - v, x -= w, K -= u, z = A * R - G * z, y = E * Q - H * y, Q = B * K - C * x, -1E-10 <= z && -1E-10 <= Q && -1E-10 <= y)) {
                            r = !1;
                            break a
                        }
                    r = !0
                }
            }
            if (r) {
                f.push([a[g[k]], a[g[l]],
                    a[g[p]]
                ]);
                h.push([g[k], g[l], g[p]]);
                k = l;
                for (p = l + 1; p < e; k++, p++) g[k] = g[p];
                e--;
                q = 2 * e
            }
        }
        return d ? h : f
    };
    a.Triangulate.area = b;
    return a
})(THREE.FontUtils);
self._typeface_js = {
    faces: THREE.FontUtils.faces,
    loadFace: THREE.FontUtils.loadFace
};
THREE.typeface_js = self._typeface_js;
THREE.Curve = function() {};
THREE.Curve.prototype.getPoint = function(a) {
    console.log("Warning, getPoint() not implemented!");
    return null
};
THREE.Curve.prototype.getPointAt = function(a) {
    a = this.getUtoTmapping(a);
    return this.getPoint(a)
};
THREE.Curve.prototype.getPoints = function(a) {
    a || (a = 5);
    var b, c = [];
    for (b = 0; b <= a; b++) c.push(this.getPoint(b / a));
    return c
};
THREE.Curve.prototype.getSpacedPoints = function(a) {
    a || (a = 5);
    var b, c = [];
    for (b = 0; b <= a; b++) c.push(this.getPointAt(b / a));
    return c
};
THREE.Curve.prototype.getLength = function() {
    var a = this.getLengths();
    return a[a.length - 1]
};
THREE.Curve.prototype.getLengths = function(a) {
    a || (a = this.__arcLengthDivisions ? this.__arcLengthDivisions : 200);
    if (this.cacheArcLengths && this.cacheArcLengths.length == a + 1 && !this.needsUpdate) return this.cacheArcLengths;
    this.needsUpdate = !1;
    var b = [],
        c, d = this.getPoint(0),
        e, f = 0;
    b.push(0);
    for (e = 1; e <= a; e++) c = this.getPoint(e / a), f += c.distanceTo(d), b.push(f), d = c;
    return this.cacheArcLengths = b
};
THREE.Curve.prototype.updateArcLengths = function() {
    this.needsUpdate = !0;
    this.getLengths()
};
THREE.Curve.prototype.getUtoTmapping = function(a, b) {
    var c = this.getLengths(),
        d = 0,
        e = c.length,
        f;
    f = b ? b : a * c[e - 1];
    for (var g = 0, h = e - 1, k; g <= h;)
        if (d = Math.floor(g + (h - g) / 2), k = c[d] - f, 0 > k) g = d + 1;
        else if (0 < k) h = d - 1;
    else {
        h = d;
        break
    }
    d = h;
    if (c[d] == f) return d / (e - 1);
    g = c[d];
    return c = (d + (f - g) / (c[d + 1] - g)) / (e - 1)
};
THREE.Curve.prototype.getTangent = function(a) {
    var b = a - 1E-4;
    a += 1E-4;
    0 > b && (b = 0);
    1 < a && (a = 1);
    b = this.getPoint(b);
    return this.getPoint(a).clone().sub(b).normalize()
};
THREE.Curve.prototype.getTangentAt = function(a) {
    a = this.getUtoTmapping(a);
    return this.getTangent(a)
};
THREE.Curve.Utils = {
    tangentQuadraticBezier: function(a, b, c, d) {
        return 2 * (1 - a) * (c - b) + 2 * a * (d - c)
    },
    tangentCubicBezier: function(a, b, c, d, e) {
        return -3 * b * (1 - a) * (1 - a) + 3 * c * (1 - a) * (1 - a) - 6 * a * c * (1 - a) + 6 * a * d * (1 - a) - 3 * a * a * d + 3 * a * a * e
    },
    tangentSpline: function(a, b, c, d, e) {
        return 6 * a * a - 6 * a + (3 * a * a - 4 * a + 1) + (-6 * a * a + 6 * a) + (3 * a * a - 2 * a)
    },
    interpolate: function(a, b, c, d, e) {
        a = 0.5 * (c - a);
        d = 0.5 * (d - b);
        var f = e * e;
        return (2 * b - 2 * c + a + d) * e * f + (-3 * b + 3 * c - 2 * a - d) * f + a * e + b
    }
};
THREE.Curve.create = function(a, b) {
    a.prototype = Object.create(THREE.Curve.prototype);
    a.prototype.getPoint = b;
    return a
};
THREE.CurvePath = function() {
    this.curves = [];
    this.bends = [];
    this.autoClose = !1
};
THREE.CurvePath.prototype = Object.create(THREE.Curve.prototype);
THREE.CurvePath.prototype.add = function(a) {
    this.curves.push(a)
};
THREE.CurvePath.prototype.checkConnection = function() {};
THREE.CurvePath.prototype.closePath = function() {
    var a = this.curves[0].getPoint(0),
        b = this.curves[this.curves.length - 1].getPoint(1);
    a.equals(b) || this.curves.push(new THREE.LineCurve(b, a))
};
THREE.CurvePath.prototype.getPoint = function(a) {
    var b = a * this.getLength(),
        c = this.getCurveLengths();
    for (a = 0; a < c.length;) {
        if (c[a] >= b) return b = c[a] - b, a = this.curves[a], b = 1 - b / a.getLength(), a.getPointAt(b);
        a++
    }
    return null
};
THREE.CurvePath.prototype.getLength = function() {
    var a = this.getCurveLengths();
    return a[a.length - 1]
};
THREE.CurvePath.prototype.getCurveLengths = function() {
    if (this.cacheLengths && this.cacheLengths.length == this.curves.length) return this.cacheLengths;
    var a = [],
        b = 0,
        c, d = this.curves.length;
    for (c = 0; c < d; c++) b += this.curves[c].getLength(), a.push(b);
    return this.cacheLengths = a
};
THREE.CurvePath.prototype.getBoundingBox = function() {
    var a = this.getPoints(),
        b, c, d, e, f, g;
    b = c = Number.NEGATIVE_INFINITY;
    e = f = Number.POSITIVE_INFINITY;
    var h, k, l, p, q = a[0] instanceof THREE.Vector3;
    p = q ? new THREE.Vector3 : new THREE.Vector2;
    k = 0;
    for (l = a.length; k < l; k++) h = a[k], h.x > b ? b = h.x : h.x < e && (e = h.x), h.y > c ? c = h.y : h.y < f && (f = h.y), q && (h.z > d ? d = h.z : h.z < g && (g = h.z)), p.add(h);
    a = {
        minX: e,
        minY: f,
        maxX: b,
        maxY: c
    };
    q && (a.maxZ = d, a.minZ = g);
    return a
};
THREE.CurvePath.prototype.createPointsGeometry = function(a) {
    a = this.getPoints(a, !0);
    return this.createGeometry(a)
};
THREE.CurvePath.prototype.createSpacedPointsGeometry = function(a) {
    a = this.getSpacedPoints(a, !0);
    return this.createGeometry(a)
};
THREE.CurvePath.prototype.createGeometry = function(a) {
    for (var b = new THREE.Geometry, c = 0; c < a.length; c++) b.vertices.push(new THREE.Vector3(a[c].x, a[c].y, a[c].z || 0));
    return b
};
THREE.CurvePath.prototype.addWrapPath = function(a) {
    this.bends.push(a)
};
THREE.CurvePath.prototype.getTransformedPoints = function(a, b) {
    var c = this.getPoints(a),
        d, e;
    b || (b = this.bends);
    d = 0;
    for (e = b.length; d < e; d++) c = this.getWrapPoints(c, b[d]);
    return c
};
THREE.CurvePath.prototype.getTransformedSpacedPoints = function(a, b) {
    var c = this.getSpacedPoints(a),
        d, e;
    b || (b = this.bends);
    d = 0;
    for (e = b.length; d < e; d++) c = this.getWrapPoints(c, b[d]);
    return c
};
THREE.CurvePath.prototype.getWrapPoints = function(a, b) {
    var c = this.getBoundingBox(),
        d, e, f, g, h, k;
    d = 0;
    for (e = a.length; d < e; d++) f = a[d], g = f.x, h = f.y, k = g / c.maxX, k = b.getUtoTmapping(k, g), g = b.getPoint(k), k = b.getTangent(k), k.set(-k.y, k.x).multiplyScalar(h), f.x = g.x + k.x, f.y = g.y + k.y;
    return a
};
THREE.Gyroscope = function() {
    THREE.Object3D.call(this)
};
THREE.Gyroscope.prototype = Object.create(THREE.Object3D.prototype);
THREE.Gyroscope.prototype.updateMatrixWorld = function(a) {
    this.matrixAutoUpdate && this.updateMatrix();
    if (this.matrixWorldNeedsUpdate || a) this.parent ? (this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix), this.matrixWorld.decompose(this.translationWorld, this.quaternionWorld, this.scaleWorld), this.matrix.decompose(this.translationObject, this.quaternionObject, this.scaleObject), this.matrixWorld.compose(this.translationWorld, this.quaternionObject, this.scaleWorld)) : this.matrixWorld.copy(this.matrix),
        this.matrixWorldNeedsUpdate = !1, a = !0;
    for (var b = 0, c = this.children.length; b < c; b++) this.children[b].updateMatrixWorld(a)
};
THREE.Gyroscope.prototype.translationWorld = new THREE.Vector3;
THREE.Gyroscope.prototype.translationObject = new THREE.Vector3;
THREE.Gyroscope.prototype.quaternionWorld = new THREE.Quaternion;
THREE.Gyroscope.prototype.quaternionObject = new THREE.Quaternion;
THREE.Gyroscope.prototype.scaleWorld = new THREE.Vector3;
THREE.Gyroscope.prototype.scaleObject = new THREE.Vector3;
THREE.Path = function(a) {
    THREE.CurvePath.call(this);
    this.actions = [];
    a && this.fromPoints(a)
};
THREE.Path.prototype = Object.create(THREE.CurvePath.prototype);
THREE.PathActions = {
    MOVE_TO: "moveTo",
    LINE_TO: "lineTo",
    QUADRATIC_CURVE_TO: "quadraticCurveTo",
    BEZIER_CURVE_TO: "bezierCurveTo",
    CSPLINE_THRU: "splineThru",
    ARC: "arc",
    ELLIPSE: "ellipse"
};
THREE.Path.prototype.fromPoints = function(a) {
    this.moveTo(a[0].x, a[0].y);
    for (var b = 1, c = a.length; b < c; b++) this.lineTo(a[b].x, a[b].y)
};
THREE.Path.prototype.moveTo = function(a, b) {
    var c = Array.prototype.slice.call(arguments);
    this.actions.push({
        action: THREE.PathActions.MOVE_TO,
        args: c
    })
};
THREE.Path.prototype.lineTo = function(a, b) {
    var c = Array.prototype.slice.call(arguments),
        d = this.actions[this.actions.length - 1].args,
        d = new THREE.LineCurve(new THREE.Vector2(d[d.length - 2], d[d.length - 1]), new THREE.Vector2(a, b));
    this.curves.push(d);
    this.actions.push({
        action: THREE.PathActions.LINE_TO,
        args: c
    })
};
THREE.Path.prototype.quadraticCurveTo = function(a, b, c, d) {
    var e = Array.prototype.slice.call(arguments),
        f = this.actions[this.actions.length - 1].args,
        f = new THREE.QuadraticBezierCurve(new THREE.Vector2(f[f.length - 2], f[f.length - 1]), new THREE.Vector2(a, b), new THREE.Vector2(c, d));
    this.curves.push(f);
    this.actions.push({
        action: THREE.PathActions.QUADRATIC_CURVE_TO,
        args: e
    })
};
THREE.Path.prototype.bezierCurveTo = function(a, b, c, d, e, f) {
    var g = Array.prototype.slice.call(arguments),
        h = this.actions[this.actions.length - 1].args,
        h = new THREE.CubicBezierCurve(new THREE.Vector2(h[h.length - 2], h[h.length - 1]), new THREE.Vector2(a, b), new THREE.Vector2(c, d), new THREE.Vector2(e, f));
    this.curves.push(h);
    this.actions.push({
        action: THREE.PathActions.BEZIER_CURVE_TO,
        args: g
    })
};
THREE.Path.prototype.splineThru = function(a) {
    var b = Array.prototype.slice.call(arguments),
        c = this.actions[this.actions.length - 1].args,
        c = [new THREE.Vector2(c[c.length - 2], c[c.length - 1])];
    Array.prototype.push.apply(c, a);
    c = new THREE.SplineCurve(c);
    this.curves.push(c);
    this.actions.push({
        action: THREE.PathActions.CSPLINE_THRU,
        args: b
    })
};
THREE.Path.prototype.arc = function(a, b, c, d, e, f) {
    var g = this.actions[this.actions.length - 1].args;
    this.absarc(a + g[g.length - 2], b + g[g.length - 1], c, d, e, f)
};
THREE.Path.prototype.absarc = function(a, b, c, d, e, f) {
    this.absellipse(a, b, c, c, d, e, f)
};
THREE.Path.prototype.ellipse = function(a, b, c, d, e, f, g) {
    var h = this.actions[this.actions.length - 1].args;
    this.absellipse(a + h[h.length - 2], b + h[h.length - 1], c, d, e, f, g)
};
THREE.Path.prototype.absellipse = function(a, b, c, d, e, f, g) {
    var h = Array.prototype.slice.call(arguments),
        k = new THREE.EllipseCurve(a, b, c, d, e, f, g);
    this.curves.push(k);
    k = k.getPoint(1);
    h.push(k.x);
    h.push(k.y);
    this.actions.push({
        action: THREE.PathActions.ELLIPSE,
        args: h
    })
};
THREE.Path.prototype.getSpacedPoints = function(a, b) {
    a || (a = 40);
    for (var c = [], d = 0; d < a; d++) c.push(this.getPoint(d / a));
    return c
};
THREE.Path.prototype.getPoints = function(a, b) {
    if (this.useSpacedPoints) return console.log("tata"), this.getSpacedPoints(a, b);
    a = a || 12;
    var c = [],
        d, e, f, g, h, k, l, p, q, r, t, s, n;
    d = 0;
    for (e = this.actions.length; d < e; d++) switch (f = this.actions[d], g = f.action, f = f.args, g) {
        case THREE.PathActions.MOVE_TO:
            c.push(new THREE.Vector2(f[0], f[1]));
            break;
        case THREE.PathActions.LINE_TO:
            c.push(new THREE.Vector2(f[0], f[1]));
            break;
        case THREE.PathActions.QUADRATIC_CURVE_TO:
            h = f[2];
            k = f[3];
            q = f[0];
            r = f[1];
            0 < c.length ? (g = c[c.length - 1], t = g.x,
                s = g.y) : (g = this.actions[d - 1].args, t = g[g.length - 2], s = g[g.length - 1]);
            for (f = 1; f <= a; f++) n = f / a, g = THREE.Shape.Utils.b2(n, t, q, h), n = THREE.Shape.Utils.b2(n, s, r, k), c.push(new THREE.Vector2(g, n));
            break;
        case THREE.PathActions.BEZIER_CURVE_TO:
            h = f[4];
            k = f[5];
            q = f[0];
            r = f[1];
            l = f[2];
            p = f[3];
            0 < c.length ? (g = c[c.length - 1], t = g.x, s = g.y) : (g = this.actions[d - 1].args, t = g[g.length - 2], s = g[g.length - 1]);
            for (f = 1; f <= a; f++) n = f / a, g = THREE.Shape.Utils.b3(n, t, q, l, h), n = THREE.Shape.Utils.b3(n, s, r, p, k), c.push(new THREE.Vector2(g, n));
            break;
        case THREE.PathActions.CSPLINE_THRU:
            g =
                this.actions[d - 1].args;
            n = [new THREE.Vector2(g[g.length - 2], g[g.length - 1])];
            g = a * f[0].length;
            n = n.concat(f[0]);
            n = new THREE.SplineCurve(n);
            for (f = 1; f <= g; f++) c.push(n.getPointAt(f / g));
            break;
        case THREE.PathActions.ARC:
            h = f[0];
            k = f[1];
            r = f[2];
            l = f[3];
            g = f[4];
            q = !!f[5];
            t = g - l;
            s = 2 * a;
            for (f = 1; f <= s; f++) n = f / s, q || (n = 1 - n), n = l + n * t, g = h + r * Math.cos(n), n = k + r * Math.sin(n), c.push(new THREE.Vector2(g, n));
            break;
        case THREE.PathActions.ELLIPSE:
            for (h = f[0], k = f[1], r = f[2], p = f[3], l = f[4], g = f[5], q = !!f[6], t = g - l, s = 2 * a, f = 1; f <= s; f++) n = f / s, q ||
                (n = 1 - n), n = l + n * t, g = h + r * Math.cos(n), n = k + p * Math.sin(n), c.push(new THREE.Vector2(g, n))
    }
    d = c[c.length - 1];
    1E-10 > Math.abs(d.x - c[0].x) && 1E-10 > Math.abs(d.y - c[0].y) && c.splice(c.length - 1, 1);
    b && c.push(c[0]);
    return c
};
THREE.Path.prototype.toShapes = function(a, b) {
    function c(a) {
        for (var b = [], c = 0, d = a.length; c < d; c++) {
            var e = a[c],
                f = new THREE.Shape;
            f.actions = e.actions;
            f.curves = e.curves;
            b.push(f)
        }
        return b
    }

    function d(a, b) {
        for (var c = b.length, d = !1, e = c - 1, f = 0; f < c; e = f++) {
            var g = b[e],
                h = b[f],
                k = h.x - g.x,
                l = h.y - g.y;
            if (1E-10 < Math.abs(l)) {
                if (0 > l && (g = b[f], k = -k, h = b[e], l = -l), !(a.y < g.y || a.y > h.y))
                    if (a.y == g.y) {
                        if (a.x == g.x) return !0
                    } else {
                        e = l * (a.x - g.x) - k * (a.y - g.y);
                        if (0 == e) return !0;
                        0 > e || (d = !d)
                    }
            } else if (a.y == g.y && (h.x <= a.x && a.x <= g.x || g.x <= a.x && a.x <=
                    h.x)) return !0
        }
        return d
    }
    var e = function(a) {
        var b, c, d, e, f = [],
            g = new THREE.Path;
        b = 0;
        for (c = a.length; b < c; b++) d = a[b], e = d.args, d = d.action, d == THREE.PathActions.MOVE_TO && 0 != g.actions.length && (f.push(g), g = new THREE.Path), g[d].apply(g, e);
        0 != g.actions.length && f.push(g);
        return f
    }(this.actions);
    if (0 == e.length) return [];
    if (!0 === b) return c(e);
    var f, g, h, k = [];
    if (1 == e.length) return g = e[0], h = new THREE.Shape, h.actions = g.actions, h.curves = g.curves, k.push(h), k;
    var l = !THREE.Shape.Utils.isClockWise(e[0].getPoints()),
        l = a ? !l : l;
    h = [];
    var p = [],
        q = [],
        r = 0,
        t;
    p[r] = void 0;
    q[r] = [];
    var s, n;
    s = 0;
    for (n = e.length; s < n; s++) g = e[s], t = g.getPoints(), f = THREE.Shape.Utils.isClockWise(t), (f = a ? !f : f) ? (!l && p[r] && r++, p[r] = {
        s: new THREE.Shape,
        p: t
    }, p[r].s.actions = g.actions, p[r].s.curves = g.curves, l && r++, q[r] = []) : q[r].push({
        h: g,
        p: t[0]
    });
    if (!p[0]) return c(e);
    if (1 < p.length) {
        s = !1;
        n = [];
        g = 0;
        for (e = p.length; g < e; g++) h[g] = [];
        g = 0;
        for (e = p.length; g < e; g++)
            for (f = q[g], l = 0; l < f.length; l++) {
                r = f[l];
                t = !0;
                for (var v = 0; v < p.length; v++) d(r.p, p[v].p) && (g != v && n.push({
                    froms: g,
                    tos: v,
                    hole: l
                }), t ? (t = !1, h[v].push(r)) : s = !0);
                t && h[g].push(r)
            }
        0 < n.length && (s || (q = h))
    }
    s = 0;
    for (n = p.length; s < n; s++)
        for (h = p[s].s, k.push(h), g = q[s], e = 0, f = g.length; e < f; e++) h.holes.push(g[e].h);
    return k
};
THREE.Shape = function() {
    THREE.Path.apply(this, arguments);
    this.holes = []
};
THREE.Shape.prototype = Object.create(THREE.Path.prototype);
THREE.Shape.prototype.extrude = function(a) {
    return new THREE.ExtrudeGeometry(this, a)
};
THREE.Shape.prototype.makeGeometry = function(a) {
    return new THREE.ShapeGeometry(this, a)
};
THREE.Shape.prototype.getPointsHoles = function(a) {
    var b, c = this.holes.length,
        d = [];
    for (b = 0; b < c; b++) d[b] = this.holes[b].getTransformedPoints(a, this.bends);
    return d
};
THREE.Shape.prototype.getSpacedPointsHoles = function(a) {
    var b, c = this.holes.length,
        d = [];
    for (b = 0; b < c; b++) d[b] = this.holes[b].getTransformedSpacedPoints(a, this.bends);
    return d
};
THREE.Shape.prototype.extractAllPoints = function(a) {
    return {
        shape: this.getTransformedPoints(a),
        holes: this.getPointsHoles(a)
    }
};
THREE.Shape.prototype.extractPoints = function(a) {
    return this.useSpacedPoints ? this.extractAllSpacedPoints(a) : this.extractAllPoints(a)
};
THREE.Shape.prototype.extractAllSpacedPoints = function(a) {
    return {
        shape: this.getTransformedSpacedPoints(a),
        holes: this.getSpacedPointsHoles(a)
    }
};
THREE.Shape.Utils = {
    triangulateShape: function(a, b) {
        function c(a, b, c) {
            return a.x != b.x ? a.x < b.x ? a.x <= c.x && c.x <= b.x : b.x <= c.x && c.x <= a.x : a.y < b.y ? a.y <= c.y && c.y <= b.y : b.y <= c.y && c.y <= a.y
        }

        function d(a, b, d, e, f) {
            var g = b.x - a.x,
                h = b.y - a.y,
                k = e.x - d.x,
                l = e.y - d.y,
                p = a.x - d.x,
                q = a.y - d.y,
                B = h * k - g * l,
                C = h * p - g * q;
            if (1E-10 < Math.abs(B)) {
                if (0 < B) {
                    if (0 > C || C > B) return [];
                    k = l * p - k * q;
                    if (0 > k || k > B) return []
                } else {
                    if (0 < C || C < B) return [];
                    k = l * p - k * q;
                    if (0 < k || k < B) return []
                }
                if (0 == k) return !f || 0 != C && C != B ? [a] : [];
                if (k == B) return !f || 0 != C && C != B ? [b] : [];
                if (0 == C) return [d];
                if (C == B) return [e];
                f = k / B;
                return [{
                    x: a.x + f * g,
                    y: a.y + f * h
                }]
            }
            if (0 != C || l * p != k * q) return [];
            h = 0 == g && 0 == h;
            k = 0 == k && 0 == l;
            if (h && k) return a.x != d.x || a.y != d.y ? [] : [a];
            if (h) return c(d, e, a) ? [a] : [];
            if (k) return c(a, b, d) ? [d] : [];
            0 != g ? (a.x < b.x ? (g = a, k = a.x, h = b, a = b.x) : (g = b, k = b.x, h = a, a = a.x), d.x < e.x ? (b = d, B = d.x, l = e, d = e.x) : (b = e, B = e.x, l = d, d = d.x)) : (a.y < b.y ? (g = a, k = a.y, h = b, a = b.y) : (g = b, k = b.y, h = a, a = a.y), d.y < e.y ? (b = d, B = d.y, l = e, d = e.y) : (b = e, B = e.y, l = d, d = d.y));
            return k <= B ? a < B ? [] : a == B ? f ? [] : [b] : a <= d ? [b, h] : [b, l] : k > d ? [] : k == d ? f ? [] : [g] : a <= d ? [g, h] : [g, l]
        }

        function e(a, b, c, d) {
            var e = b.x - a.x,
                f = b.y - a.y;
            b = c.x - a.x;
            c = c.y - a.y;
            var g = d.x - a.x;
            d = d.y - a.y;
            a = e * c - f * b;
            e = e * d - f * g;
            return 1E-10 < Math.abs(a) ? (b = g * c - d * b, 0 < a ? 0 <= e && 0 <= b : 0 <= e || 0 <= b) : 0 < e
        }
        var f, g, h, k, l, p = {};
        h = a.concat();
        f = 0;
        for (g = b.length; f < g; f++) Array.prototype.push.apply(h, b[f]);
        f = 0;
        for (g = h.length; f < g; f++) l = h[f].x + ":" + h[f].y, void 0 !== p[l] && console.log("Duplicate point", l), p[l] = f;
        f = function(a, b) {
            function c(a, b) {
                var d = h.length - 1,
                    f = a - 1;
                0 > f && (f = d);
                var g = a + 1;
                g > d && (g = 0);
                d = e(h[a], h[f], h[g], k[b]);
                if (!d) return !1;
                d = k.length - 1;
                f = b - 1;
                0 > f && (f = d);
                g = b + 1;
                g > d && (g = 0);
                return (d = e(k[b], k[f], k[g], h[a])) ? !0 : !1
            }

            function f(a, b) {
                var c, e;
                for (c = 0; c < h.length; c++)
                    if (e = c + 1, e %= h.length, e = d(a, b, h[c], h[e], !0), 0 < e.length) return !0;
                return !1
            }

            function g(a, c) {
                var e, f, h, k;
                for (e = 0; e < l.length; e++)
                    for (f = b[l[e]], h = 0; h < f.length; h++)
                        if (k = h + 1, k %= f.length, k = d(a, c, f[h], f[k], !0), 0 < k.length) return !0;
                return !1
            }
            var h = a.concat(),
                k, l = [],
                p, q, G, B, C, E = [],
                H, y, Q, z = 0;
            for (p = b.length; z < p; z++) l.push(z);
            H = 0;
            for (var R = 2 * l.length; 0 < l.length;) {
                R--;
                if (0 > R) {
                    console.log("Infinite Loop! Holes left:" +
                        l.length + ", Probably Hole outside Shape!");
                    break
                }
                for (q = H; q < h.length; q++) {
                    G = h[q];
                    p = -1;
                    for (z = 0; z < l.length; z++)
                        if (B = l[z], C = G.x + ":" + G.y + ":" + B, void 0 === E[C]) {
                            k = b[B];
                            for (y = 0; y < k.length; y++)
                                if (B = k[y], c(q, y) && !f(G, B) && !g(G, B)) {
                                    p = y;
                                    l.splice(z, 1);
                                    H = h.slice(0, q + 1);
                                    B = h.slice(q);
                                    y = k.slice(p);
                                    Q = k.slice(0, p + 1);
                                    h = H.concat(y).concat(Q).concat(B);
                                    H = q;
                                    break
                                }
                            if (0 <= p) break;
                            E[C] = !0
                        }
                    if (0 <= p) break
                }
            }
            return h
        }(a, b);
        var q = THREE.FontUtils.Triangulate(f, !1);
        f = 0;
        for (g = q.length; f < g; f++)
            for (k = q[f], h = 0; 3 > h; h++) l = k[h].x + ":" + k[h].y,
                l = p[l], void 0 !== l && (k[h] = l);
        return q.concat()
    },
    isClockWise: function(a) {
        return 0 > THREE.FontUtils.Triangulate.area(a)
    },
    b2p0: function(a, b) {
        var c = 1 - a;
        return c * c * b
    },
    b2p1: function(a, b) {
        return 2 * (1 - a) * a * b
    },
    b2p2: function(a, b) {
        return a * a * b
    },
    b2: function(a, b, c, d) {
        return this.b2p0(a, b) + this.b2p1(a, c) + this.b2p2(a, d)
    },
    b3p0: function(a, b) {
        var c = 1 - a;
        return c * c * c * b
    },
    b3p1: function(a, b) {
        var c = 1 - a;
        return 3 * c * c * a * b
    },
    b3p2: function(a, b) {
        return 3 * (1 - a) * a * a * b
    },
    b3p3: function(a, b) {
        return a * a * a * b
    },
    b3: function(a, b, c, d, e) {
        return this.b3p0(a,
            b) + this.b3p1(a, c) + this.b3p2(a, d) + this.b3p3(a, e)
    }
};
THREE.LineCurve = function(a, b) {
    this.v1 = a;
    this.v2 = b
};
THREE.LineCurve.prototype = Object.create(THREE.Curve.prototype);
THREE.LineCurve.prototype.getPoint = function(a) {
    var b = this.v2.clone().sub(this.v1);
    b.multiplyScalar(a).add(this.v1);
    return b
};
THREE.LineCurve.prototype.getPointAt = function(a) {
    return this.getPoint(a)
};
THREE.LineCurve.prototype.getTangent = function(a) {
    return this.v2.clone().sub(this.v1).normalize()
};
THREE.QuadraticBezierCurve = function(a, b, c) {
    this.v0 = a;
    this.v1 = b;
    this.v2 = c
};
THREE.QuadraticBezierCurve.prototype = Object.create(THREE.Curve.prototype);
THREE.QuadraticBezierCurve.prototype.getPoint = function(a) {
    var b;
    b = THREE.Shape.Utils.b2(a, this.v0.x, this.v1.x, this.v2.x);
    a = THREE.Shape.Utils.b2(a, this.v0.y, this.v1.y, this.v2.y);
    return new THREE.Vector2(b, a)
};
THREE.QuadraticBezierCurve.prototype.getTangent = function(a) {
    var b;
    b = THREE.Curve.Utils.tangentQuadraticBezier(a, this.v0.x, this.v1.x, this.v2.x);
    a = THREE.Curve.Utils.tangentQuadraticBezier(a, this.v0.y, this.v1.y, this.v2.y);
    b = new THREE.Vector2(b, a);
    b.normalize();
    return b
};
THREE.CubicBezierCurve = function(a, b, c, d) {
    this.v0 = a;
    this.v1 = b;
    this.v2 = c;
    this.v3 = d
};
THREE.CubicBezierCurve.prototype = Object.create(THREE.Curve.prototype);
THREE.CubicBezierCurve.prototype.getPoint = function(a) {
    var b;
    b = THREE.Shape.Utils.b3(a, this.v0.x, this.v1.x, this.v2.x, this.v3.x);
    a = THREE.Shape.Utils.b3(a, this.v0.y, this.v1.y, this.v2.y, this.v3.y);
    return new THREE.Vector2(b, a)
};
THREE.CubicBezierCurve.prototype.getTangent = function(a) {
    var b;
    b = THREE.Curve.Utils.tangentCubicBezier(a, this.v0.x, this.v1.x, this.v2.x, this.v3.x);
    a = THREE.Curve.Utils.tangentCubicBezier(a, this.v0.y, this.v1.y, this.v2.y, this.v3.y);
    b = new THREE.Vector2(b, a);
    b.normalize();
    return b
};
THREE.SplineCurve = function(a) {
    this.points = void 0 == a ? [] : a
};
THREE.SplineCurve.prototype = Object.create(THREE.Curve.prototype);
THREE.SplineCurve.prototype.getPoint = function(a) {
    var b = new THREE.Vector2,
        c = [],
        d = this.points,
        e;
    e = (d.length - 1) * a;
    a = Math.floor(e);
    e -= a;
    c[0] = 0 == a ? a : a - 1;
    c[1] = a;
    c[2] = a > d.length - 2 ? d.length - 1 : a + 1;
    c[3] = a > d.length - 3 ? d.length - 1 : a + 2;
    b.x = THREE.Curve.Utils.interpolate(d[c[0]].x, d[c[1]].x, d[c[2]].x, d[c[3]].x, e);
    b.y = THREE.Curve.Utils.interpolate(d[c[0]].y, d[c[1]].y, d[c[2]].y, d[c[3]].y, e);
    return b
};
THREE.EllipseCurve = function(a, b, c, d, e, f, g) {
    this.aX = a;
    this.aY = b;
    this.xRadius = c;
    this.yRadius = d;
    this.aStartAngle = e;
    this.aEndAngle = f;
    this.aClockwise = g
};
THREE.EllipseCurve.prototype = Object.create(THREE.Curve.prototype);
THREE.EllipseCurve.prototype.getPoint = function(a) {
    var b;
    b = this.aEndAngle - this.aStartAngle;
    0 > b && (b += 2 * Math.PI);
    b > 2 * Math.PI && (b -= 2 * Math.PI);
    b = !0 === this.aClockwise ? this.aEndAngle + (1 - a) * (2 * Math.PI - b) : this.aStartAngle + a * b;
    a = this.aX + this.xRadius * Math.cos(b);
    b = this.aY + this.yRadius * Math.sin(b);
    return new THREE.Vector2(a, b)
};
THREE.ArcCurve = function(a, b, c, d, e, f) {
    THREE.EllipseCurve.call(this, a, b, c, c, d, e, f)
};
THREE.ArcCurve.prototype = Object.create(THREE.EllipseCurve.prototype);
THREE.LineCurve3 = THREE.Curve.create(function(a, b) {
    this.v1 = a;
    this.v2 = b
}, function(a) {
    var b = new THREE.Vector3;
    b.subVectors(this.v2, this.v1);
    b.multiplyScalar(a);
    b.add(this.v1);
    return b
});
THREE.QuadraticBezierCurve3 = THREE.Curve.create(function(a, b, c) {
    this.v0 = a;
    this.v1 = b;
    this.v2 = c
}, function(a) {
    var b, c;
    b = THREE.Shape.Utils.b2(a, this.v0.x, this.v1.x, this.v2.x);
    c = THREE.Shape.Utils.b2(a, this.v0.y, this.v1.y, this.v2.y);
    a = THREE.Shape.Utils.b2(a, this.v0.z, this.v1.z, this.v2.z);
    return new THREE.Vector3(b, c, a)
});
THREE.CubicBezierCurve3 = THREE.Curve.create(function(a, b, c, d) {
    this.v0 = a;
    this.v1 = b;
    this.v2 = c;
    this.v3 = d
}, function(a) {
    var b, c;
    b = THREE.Shape.Utils.b3(a, this.v0.x, this.v1.x, this.v2.x, this.v3.x);
    c = THREE.Shape.Utils.b3(a, this.v0.y, this.v1.y, this.v2.y, this.v3.y);
    a = THREE.Shape.Utils.b3(a, this.v0.z, this.v1.z, this.v2.z, this.v3.z);
    return new THREE.Vector3(b, c, a)
});
THREE.SplineCurve3 = THREE.Curve.create(function(a) {
    this.points = void 0 == a ? [] : a
}, function(a) {
    var b = new THREE.Vector3,
        c = [],
        d = this.points,
        e;
    a *= d.length - 1;
    e = Math.floor(a);
    a -= e;
    c[0] = 0 == e ? e : e - 1;
    c[1] = e;
    c[2] = e > d.length - 2 ? d.length - 1 : e + 1;
    c[3] = e > d.length - 3 ? d.length - 1 : e + 2;
    e = d[c[0]];
    var f = d[c[1]],
        g = d[c[2]],
        c = d[c[3]];
    b.x = THREE.Curve.Utils.interpolate(e.x, f.x, g.x, c.x, a);
    b.y = THREE.Curve.Utils.interpolate(e.y, f.y, g.y, c.y, a);
    b.z = THREE.Curve.Utils.interpolate(e.z, f.z, g.z, c.z, a);
    return b
});
THREE.ClosedSplineCurve3 = THREE.Curve.create(function(a) {
    this.points = void 0 == a ? [] : a
}, function(a) {
    var b = new THREE.Vector3,
        c = [],
        d = this.points,
        e;
    e = (d.length - 0) * a;
    a = Math.floor(e);
    e -= a;
    a += 0 < a ? 0 : (Math.floor(Math.abs(a) / d.length) + 1) * d.length;
    c[0] = (a - 1) % d.length;
    c[1] = a % d.length;
    c[2] = (a + 1) % d.length;
    c[3] = (a + 2) % d.length;
    b.x = THREE.Curve.Utils.interpolate(d[c[0]].x, d[c[1]].x, d[c[2]].x, d[c[3]].x, e);
    b.y = THREE.Curve.Utils.interpolate(d[c[0]].y, d[c[1]].y, d[c[2]].y, d[c[3]].y, e);
    b.z = THREE.Curve.Utils.interpolate(d[c[0]].z,
        d[c[1]].z, d[c[2]].z, d[c[3]].z, e);
    return b
});
THREE.AnimationHandler = {
    LINEAR: 0,
    CATMULLROM: 1,
    CATMULLROM_FORWARD: 2,
    add: function() {
        console.warn("THREE.AnimationHandler.add() has been deprecated.")
    },
    get: function() {
        console.warn("THREE.AnimationHandler.get() has been deprecated.")
    },
    remove: function() {
        console.warn("THREE.AnimationHandler.remove() has been deprecated.")
    },
    animations: [],
    init: function(a) {
        if (!0 !== a.initialized) {
            for (var b = 0; b < a.hierarchy.length; b++) {
                for (var c = 0; c < a.hierarchy[b].keys.length; c++)
                    if (0 > a.hierarchy[b].keys[c].time && (a.hierarchy[b].keys[c].time =
                            0), void 0 !== a.hierarchy[b].keys[c].rot && !(a.hierarchy[b].keys[c].rot instanceof THREE.Quaternion)) {
                        var d = a.hierarchy[b].keys[c].rot;
                        a.hierarchy[b].keys[c].rot = (new THREE.Quaternion).fromArray(d)
                    }
                if (a.hierarchy[b].keys.length && void 0 !== a.hierarchy[b].keys[0].morphTargets) {
                    d = {};
                    for (c = 0; c < a.hierarchy[b].keys.length; c++)
                        for (var e = 0; e < a.hierarchy[b].keys[c].morphTargets.length; e++) {
                            var f = a.hierarchy[b].keys[c].morphTargets[e];
                            d[f] = -1
                        }
                    a.hierarchy[b].usedMorphTargets = d;
                    for (c = 0; c < a.hierarchy[b].keys.length; c++) {
                        var g = {};
                        for (f in d) {
                            for (e = 0; e < a.hierarchy[b].keys[c].morphTargets.length; e++)
                                if (a.hierarchy[b].keys[c].morphTargets[e] === f) {
                                    g[f] = a.hierarchy[b].keys[c].morphTargetsInfluences[e];
                                    break
                                }
                            e === a.hierarchy[b].keys[c].morphTargets.length && (g[f] = 0)
                        }
                        a.hierarchy[b].keys[c].morphTargetsInfluences = g
                    }
                }
                for (c = 1; c < a.hierarchy[b].keys.length; c++) a.hierarchy[b].keys[c].time === a.hierarchy[b].keys[c - 1].time && (a.hierarchy[b].keys.splice(c, 1), c--);
                for (c = 0; c < a.hierarchy[b].keys.length; c++) a.hierarchy[b].keys[c].index = c
            }
            a.initialized = !0;
            return a
        }
    },
    parse: function(a) {
        var b = function(a, c) {
                c.push(a);
                for (var d = 0; d < a.children.length; d++) b(a.children[d], c)
            },
            c = [];
        if (a instanceof THREE.SkinnedMesh)
            for (var d = 0; d < a.skeleton.bones.length; d++) c.push(a.skeleton.bones[d]);
        else b(a, c);
        return c
    },
    play: function(a) {
        -1 === this.animations.indexOf(a) && this.animations.push(a)
    },
    stop: function(a) {
        a = this.animations.indexOf(a); - 1 !== a && this.animations.splice(a, 1)
    },
    update: function(a) {
        for (var b = 0; b < this.animations.length; b++) this.animations[b].update(a)
    }
};
THREE.Animation = function(a, b) {
    this.root = a;
    this.data = THREE.AnimationHandler.init(b);
    this.hierarchy = THREE.AnimationHandler.parse(a);
    this.currentTime = 0;
    this.timeScale = 1;
    this.isPlaying = !1;
    this.loop = !0;
    this.weight = 0;
    this.interpolationType = THREE.AnimationHandler.LINEAR
};
THREE.Animation.prototype.keyTypes = ["pos", "rot", "scl"];
THREE.Animation.prototype.play = function(a, b) {
    this.currentTime = void 0 !== a ? a : 0;
    this.weight = void 0 !== b ? b : 1;
    this.isPlaying = !0;
    this.reset();
    THREE.AnimationHandler.play(this)
};
THREE.Animation.prototype.stop = function() {
    this.isPlaying = !1;
    THREE.AnimationHandler.stop(this)
};
THREE.Animation.prototype.reset = function() {
    for (var a = 0, b = this.hierarchy.length; a < b; a++) {
        var c = this.hierarchy[a];
        c.matrixAutoUpdate = !0;
        void 0 === c.animationCache && (c.animationCache = {});
        void 0 === c.animationCache[this.data.name] && (c.animationCache[this.data.name] = {}, c.animationCache[this.data.name].prevKey = {
            pos: 0,
            rot: 0,
            scl: 0
        }, c.animationCache[this.data.name].nextKey = {
            pos: 0,
            rot: 0,
            scl: 0
        }, c.animationCache[this.data.name].originalMatrix = c instanceof THREE.Bone ? c.skinMatrix : c.matrix);
        for (var c = c.animationCache[this.data.name],
                d = 0; 3 > d; d++) {
            for (var e = this.keyTypes[d], f = this.data.hierarchy[a].keys[0], g = this.getNextKeyWith(e, a, 1); g.time < this.currentTime && g.index > f.index;) f = g, g = this.getNextKeyWith(e, a, g.index + 1);
            c.prevKey[e] = f;
            c.nextKey[e] = g
        }
    }
};
THREE.Animation.prototype.update = function() {
    var a = [],
        b = new THREE.Vector3,
        c = new THREE.Vector3,
        d = new THREE.Quaternion,
        e = function(a, b) {
            var c = [],
                d = [],
                e, q, r, t, s, n;
            e = (a.length - 1) * b;
            q = Math.floor(e);
            e -= q;
            c[0] = 0 === q ? q : q - 1;
            c[1] = q;
            c[2] = q > a.length - 2 ? q : q + 1;
            c[3] = q > a.length - 3 ? q : q + 2;
            q = a[c[0]];
            t = a[c[1]];
            s = a[c[2]];
            n = a[c[3]];
            c = e * e;
            r = e * c;
            d[0] = f(q[0], t[0], s[0], n[0], e, c, r);
            d[1] = f(q[1], t[1], s[1], n[1], e, c, r);
            d[2] = f(q[2], t[2], s[2], n[2], e, c, r);
            return d
        },
        f = function(a, b, c, d, e, f, r) {
            a = 0.5 * (c - a);
            d = 0.5 * (d - b);
            return (2 * (b - c) + a + d) *
                r + (-3 * (b - c) - 2 * a - d) * f + a * e + b
        };
    return function(f) {
        if (!1 !== this.isPlaying && (this.currentTime += f * this.timeScale, 0 !== this.weight)) {
            f = this.data.length;
            if (!0 === this.loop && this.currentTime > f) this.currentTime %= f, this.reset();
            else if (!1 === this.loop && this.currentTime > f) {
                this.stop();
                return
            }
            f = 0;
            for (var h = this.hierarchy.length; f < h; f++)
                for (var k = this.hierarchy[f], l = k.animationCache[this.data.name], p = 0; 3 > p; p++) {
                    var q = this.keyTypes[p],
                        r = l.prevKey[q],
                        t = l.nextKey[q];
                    if (t.time <= this.currentTime) {
                        r = this.data.hierarchy[f].keys[0];
                        for (t = this.getNextKeyWith(q, f, 1); t.time < this.currentTime && t.index > r.index;) r = t, t = this.getNextKeyWith(q, f, t.index + 1);
                        l.prevKey[q] = r;
                        l.nextKey[q] = t
                    }
                    k.matrixAutoUpdate = !0;
                    k.matrixWorldNeedsUpdate = !0;
                    var s = (this.currentTime - r.time) / (t.time - r.time),
                        n = r[q],
                        v = t[q];
                    0 > s && (s = 0);
                    1 < s && (s = 1);
                    if ("pos" === q)
                        if (this.interpolationType === THREE.AnimationHandler.LINEAR) c.x = n[0] + (v[0] - n[0]) * s, c.y = n[1] + (v[1] - n[1]) * s, c.z = n[2] + (v[2] - n[2]) * s, k instanceof THREE.Bone ? (r = this.weight / (this.weight + k.accumulatedPosWeight), k.position.lerp(c,
                            r), k.accumulatedPosWeight += this.weight) : k.position.copy(c);
                        else {
                            if (this.interpolationType === THREE.AnimationHandler.CATMULLROM || this.interpolationType === THREE.AnimationHandler.CATMULLROM_FORWARD) a[0] = this.getPrevKeyWith("pos", f, r.index - 1).pos, a[1] = n, a[2] = v, a[3] = this.getNextKeyWith("pos", f, t.index + 1).pos, s = 0.33 * s + 0.33, t = e(a, s), r = 1, k instanceof THREE.Bone && (r = this.weight / (this.weight + k.accumulatedPosWeight), k.accumulatedPosWeight += this.weight), q = k.position, q.x += (t[0] - q.x) * r, q.y += (t[1] - q.y) * r, q.z += (t[2] -
                                q.z) * r, this.interpolationType === THREE.AnimationHandler.CATMULLROM_FORWARD && (s = e(a, 1.01 * s), b.set(s[0], s[1], s[2]), b.sub(q), b.y = 0, b.normalize(), s = Math.atan2(b.x, b.z), k.rotation.set(0, s, 0))
                        } else "rot" === q ? (THREE.Quaternion.slerp(n, v, d, s), k instanceof THREE.Bone ? 0 === k.accumulatedRotWeight ? (k.quaternion.copy(d), k.accumulatedRotWeight = this.weight) : (r = this.weight / (this.weight + k.accumulatedRotWeight), THREE.Quaternion.slerp(k.quaternion, d, k.quaternion, r), k.accumulatedRotWeight += this.weight) : k.quaternion.copy(d)) :
                        "scl" === q && (c.x = n[0] + (v[0] - n[0]) * s, c.y = n[1] + (v[1] - n[1]) * s, c.z = n[2] + (v[2] - n[2]) * s, k instanceof THREE.Bone ? (r = this.weight / (this.weight + k.accumulatedSclWeight), k.scale.lerp(c, r), k.accumulatedSclWeight += this.weight) : k.scale.copy(c))
                }
            return !0
        }
    }
}();
THREE.Animation.prototype.getNextKeyWith = function(a, b, c) {
    var d = this.data.hierarchy[b].keys;
    for (c = this.interpolationType === THREE.AnimationHandler.CATMULLROM || this.interpolationType === THREE.AnimationHandler.CATMULLROM_FORWARD ? c < d.length - 1 ? c : d.length - 1 : c % d.length; c < d.length; c++)
        if (void 0 !== d[c][a]) return d[c];
    return this.data.hierarchy[b].keys[0]
};
THREE.Animation.prototype.getPrevKeyWith = function(a, b, c) {
    var d = this.data.hierarchy[b].keys;
    for (c = this.interpolationType === THREE.AnimationHandler.CATMULLROM || this.interpolationType === THREE.AnimationHandler.CATMULLROM_FORWARD ? 0 < c ? c : 0 : 0 <= c ? c : c + d.length; 0 <= c; c--)
        if (void 0 !== d[c][a]) return d[c];
    return this.data.hierarchy[b].keys[d.length - 1]
};
THREE.KeyFrameAnimation = function(a) {
    this.root = a.node;
    this.data = THREE.AnimationHandler.init(a);
    this.hierarchy = THREE.AnimationHandler.parse(this.root);
    this.currentTime = 0;
    this.timeScale = 0.001;
    this.isPlaying = !1;
    this.loop = this.isPaused = !0;
    a = 0;
    for (var b = this.hierarchy.length; a < b; a++) {
        var c = this.data.hierarchy[a].sids,
            d = this.hierarchy[a];
        if (this.data.hierarchy[a].keys.length && c) {
            for (var e = 0; e < c.length; e++) {
                var f = c[e],
                    g = this.getNextKeyWith(f, a, 0);
                g && g.apply(f)
            }
            d.matrixAutoUpdate = !1;
            this.data.hierarchy[a].node.updateMatrix();
            d.matrixWorldNeedsUpdate = !0
        }
    }
};
THREE.KeyFrameAnimation.prototype.play = function(a) {
    this.currentTime = void 0 !== a ? a : 0;
    if (!1 === this.isPlaying) {
        this.isPlaying = !0;
        var b = this.hierarchy.length,
            c, d;
        for (a = 0; a < b; a++) c = this.hierarchy[a], d = this.data.hierarchy[a], void 0 === d.animationCache && (d.animationCache = {}, d.animationCache.prevKey = null, d.animationCache.nextKey = null, d.animationCache.originalMatrix = c instanceof THREE.Bone ? c.skinMatrix : c.matrix), c = this.data.hierarchy[a].keys, c.length && (d.animationCache.prevKey = c[0], d.animationCache.nextKey =
            c[1], this.startTime = Math.min(c[0].time, this.startTime), this.endTime = Math.max(c[c.length - 1].time, this.endTime));
        this.update(0)
    }
    this.isPaused = !1;
    THREE.AnimationHandler.play(this)
};
THREE.KeyFrameAnimation.prototype.stop = function() {
    this.isPaused = this.isPlaying = !1;
    THREE.AnimationHandler.stop(this);
    for (var a = 0; a < this.data.hierarchy.length; a++) {
        var b = this.hierarchy[a],
            c = this.data.hierarchy[a];
        if (void 0 !== c.animationCache) {
            var d = c.animationCache.originalMatrix;
            b instanceof THREE.Bone ? (d.copy(b.skinMatrix), b.skinMatrix = d) : (d.copy(b.matrix), b.matrix = d);
            delete c.animationCache
        }
    }
};
THREE.KeyFrameAnimation.prototype.update = function(a) {
    if (!1 !== this.isPlaying) {
        this.currentTime += a * this.timeScale;
        a = this.data.length;
        !0 === this.loop && this.currentTime > a && (this.currentTime %= a);
        this.currentTime = Math.min(this.currentTime, a);
        a = 0;
        for (var b = this.hierarchy.length; a < b; a++) {
            var c = this.hierarchy[a],
                d = this.data.hierarchy[a],
                e = d.keys,
                d = d.animationCache;
            if (e.length) {
                var f = d.prevKey,
                    g = d.nextKey;
                if (g.time <= this.currentTime) {
                    for (; g.time < this.currentTime && g.index > f.index;) f = g, g = e[f.index + 1];
                    d.prevKey =
                        f;
                    d.nextKey = g
                }
                g.time >= this.currentTime ? f.interpolate(g, this.currentTime) : f.interpolate(g, g.time);
                this.data.hierarchy[a].node.updateMatrix();
                c.matrixWorldNeedsUpdate = !0
            }
        }
    }
};
THREE.KeyFrameAnimation.prototype.getNextKeyWith = function(a, b, c) {
    b = this.data.hierarchy[b].keys;
    for (c %= b.length; c < b.length; c++)
        if (b[c].hasTarget(a)) return b[c];
    return b[0]
};
THREE.KeyFrameAnimation.prototype.getPrevKeyWith = function(a, b, c) {
    b = this.data.hierarchy[b].keys;
    for (c = 0 <= c ? c : c + b.length; 0 <= c; c--)
        if (b[c].hasTarget(a)) return b[c];
    return b[b.length - 1]
};
THREE.MorphAnimation = function(a) {
    this.mesh = a;
    this.frames = a.morphTargetInfluences.length;
    this.currentTime = 0;
    this.duration = 1E3;
    this.loop = !0;
    this.isPlaying = !1
};
THREE.MorphAnimation.prototype = {
    play: function() {
        this.isPlaying = !0
    },
    pause: function() {
        this.isPlaying = !1
    },
    update: function() {
        var a = 0,
            b = 0;
        return function(c) {
            if (!1 !== this.isPlaying) {
                this.currentTime += c;
                !0 === this.loop && this.currentTime > this.duration && (this.currentTime %= this.duration);
                this.currentTime = Math.min(this.currentTime, this.duration);
                c = this.duration / this.frames;
                var d = Math.floor(this.currentTime / c);
                d != b && (this.mesh.morphTargetInfluences[a] = 0, this.mesh.morphTargetInfluences[b] = 1, this.mesh.morphTargetInfluences[d] =
                    0, a = b, b = d);
                this.mesh.morphTargetInfluences[d] = this.currentTime % c / c;
                this.mesh.morphTargetInfluences[a] = 1 - this.mesh.morphTargetInfluences[d]
            }
        }
    }()
};
THREE.BoxGeometry = function(a, b, c, d, e, f) {
    function g(a, b, c, d, e, f, g, n) {
        var v, w = h.widthSegments,
            u = h.heightSegments,
            x = e / 2,
            K = f / 2,
            A = h.vertices.length;
        if ("x" === a && "y" === b || "y" === a && "x" === b) v = "z";
        else if ("x" === a && "z" === b || "z" === a && "x" === b) v = "y", u = h.depthSegments;
        else if ("z" === a && "y" === b || "y" === a && "z" === b) v = "x", w = h.depthSegments;
        var G = w + 1,
            B = u + 1,
            C = e / w,
            E = f / u,
            H = new THREE.Vector3;
        H[v] = 0 < g ? 1 : -1;
        for (e = 0; e < B; e++)
            for (f = 0; f < G; f++) {
                var y = new THREE.Vector3;
                y[a] = (f * C - x) * c;
                y[b] = (e * E - K) * d;
                y[v] = g;
                h.vertices.push(y)
            }
        for (e =
            0; e < u; e++)
            for (f = 0; f < w; f++) K = f + G * e, a = f + G * (e + 1), b = f + 1 + G * (e + 1), c = f + 1 + G * e, d = new THREE.Vector2(f / w, 1 - e / u), g = new THREE.Vector2(f / w, 1 - (e + 1) / u), v = new THREE.Vector2((f + 1) / w, 1 - (e + 1) / u), x = new THREE.Vector2((f + 1) / w, 1 - e / u), K = new THREE.Face3(K + A, a + A, c + A), K.normal.copy(H), K.vertexNormals.push(H.clone(), H.clone(), H.clone()), K.materialIndex = n, h.faces.push(K), h.faceVertexUvs[0].push([d, g, x]), K = new THREE.Face3(a + A, b + A, c + A), K.normal.copy(H), K.vertexNormals.push(H.clone(), H.clone(), H.clone()), K.materialIndex = n, h.faces.push(K),
                h.faceVertexUvs[0].push([g.clone(), v, x.clone()])
    }
    THREE.Geometry.call(this);
    this.parameters = {
        width: a,
        height: b,
        depth: c,
        widthSegments: d,
        heightSegments: e,
        depthSegments: f
    };
    this.widthSegments = d || 1;
    this.heightSegments = e || 1;
    this.depthSegments = f || 1;
    var h = this;
    d = a / 2;
    e = b / 2;
    f = c / 2;
    g("z", "y", -1, -1, c, b, d, 0);
    g("z", "y", 1, -1, c, b, -d, 1);
    g("x", "z", 1, 1, a, c, e, 2);
    g("x", "z", 1, -1, a, c, -e, 3);
    g("x", "y", 1, -1, a, b, f, 4);
    g("x", "y", -1, -1, a, b, -f, 5);
    this.mergeVertices()
};
THREE.BoxGeometry.prototype = Object.create(THREE.Geometry.prototype);
THREE.CircleGeometry = function(a, b, c, d) {
    THREE.Geometry.call(this);
    this.parameters = {
        radius: a,
        segments: b,
        thetaStart: c,
        thetaLength: d
    };
    a = a || 50;
    b = void 0 !== b ? Math.max(3, b) : 8;
    c = void 0 !== c ? c : 0;
    d = void 0 !== d ? d : 2 * Math.PI;
    var e, f = [];
    e = new THREE.Vector3;
    var g = new THREE.Vector2(0.5, 0.5);
    this.vertices.push(e);
    f.push(g);
    for (e = 0; e <= b; e++) {
        var h = new THREE.Vector3,
            k = c + e / b * d;
        h.x = a * Math.cos(k);
        h.y = a * Math.sin(k);
        this.vertices.push(h);
        f.push(new THREE.Vector2((h.x / a + 1) / 2, (h.y / a + 1) / 2))
    }
    c = new THREE.Vector3(0, 0, 1);
    for (e = 1; e <=
        b; e++) this.faces.push(new THREE.Face3(e, e + 1, 0, [c.clone(), c.clone(), c.clone()])), this.faceVertexUvs[0].push([f[e].clone(), f[e + 1].clone(), g.clone()]);
    this.computeFaceNormals();
    this.boundingSphere = new THREE.Sphere(new THREE.Vector3, a)
};
THREE.CircleGeometry.prototype = Object.create(THREE.Geometry.prototype);
THREE.CubeGeometry = function(a, b, c, d, e, f) {
    console.warn("THEE.CubeGeometry has been renamed to THREE.BoxGeometry.");
    return new THREE.BoxGeometry(a, b, c, d, e, f)
};
THREE.CylinderGeometry = function(a, b, c, d, e, f) {
    THREE.Geometry.call(this);
    this.parameters = {
        radiusTop: a,
        radiusBottom: b,
        height: c,
        radialSegments: d,
        heightSegments: e,
        openEnded: f
    };
    a = void 0 !== a ? a : 20;
    b = void 0 !== b ? b : 20;
    c = void 0 !== c ? c : 100;
    d = d || 8;
    e = e || 1;
    f = void 0 !== f ? f : !1;
    var g = c / 2,
        h, k, l = [],
        p = [];
    for (k = 0; k <= e; k++) {
        var q = [],
            r = [],
            t = k / e,
            s = t * (b - a) + a;
        for (h = 0; h <= d; h++) {
            var n = h / d,
                v = new THREE.Vector3;
            v.x = s * Math.sin(n * Math.PI * 2);
            v.y = -t * c + g;
            v.z = s * Math.cos(n * Math.PI * 2);
            this.vertices.push(v);
            q.push(this.vertices.length - 1);
            r.push(new THREE.Vector2(n,
                1 - t))
        }
        l.push(q);
        p.push(r)
    }
    c = (b - a) / c;
    for (h = 0; h < d; h++)
        for (0 !== a ? (q = this.vertices[l[0][h]].clone(), r = this.vertices[l[0][h + 1]].clone()) : (q = this.vertices[l[1][h]].clone(), r = this.vertices[l[1][h + 1]].clone()), q.setY(Math.sqrt(q.x * q.x + q.z * q.z) * c).normalize(), r.setY(Math.sqrt(r.x * r.x + r.z * r.z) * c).normalize(), k = 0; k < e; k++) {
            var t = l[k][h],
                s = l[k + 1][h],
                n = l[k + 1][h + 1],
                v = l[k][h + 1],
                w = q.clone(),
                u = q.clone(),
                x = r.clone(),
                K = r.clone(),
                A = p[k][h].clone(),
                G = p[k + 1][h].clone(),
                B = p[k + 1][h + 1].clone(),
                C = p[k][h + 1].clone();
            this.faces.push(new THREE.Face3(t,
                s, v, [w, u, K]));
            this.faceVertexUvs[0].push([A, G, C]);
            this.faces.push(new THREE.Face3(s, n, v, [u.clone(), x, K.clone()]));
            this.faceVertexUvs[0].push([G.clone(), B, C.clone()])
        }
    if (!1 === f && 0 < a)
        for (this.vertices.push(new THREE.Vector3(0, g, 0)), h = 0; h < d; h++) t = l[0][h], s = l[0][h + 1], n = this.vertices.length - 1, w = new THREE.Vector3(0, 1, 0), u = new THREE.Vector3(0, 1, 0), x = new THREE.Vector3(0, 1, 0), A = p[0][h].clone(), G = p[0][h + 1].clone(), B = new THREE.Vector2(G.x, 0), this.faces.push(new THREE.Face3(t, s, n, [w, u, x])), this.faceVertexUvs[0].push([A,
            G, B
        ]);
    if (!1 === f && 0 < b)
        for (this.vertices.push(new THREE.Vector3(0, -g, 0)), h = 0; h < d; h++) t = l[k][h + 1], s = l[k][h], n = this.vertices.length - 1, w = new THREE.Vector3(0, -1, 0), u = new THREE.Vector3(0, -1, 0), x = new THREE.Vector3(0, -1, 0), A = p[k][h + 1].clone(), G = p[k][h].clone(), B = new THREE.Vector2(G.x, 1), this.faces.push(new THREE.Face3(t, s, n, [w, u, x])), this.faceVertexUvs[0].push([A, G, B]);
    this.computeFaceNormals()
};
THREE.CylinderGeometry.prototype = Object.create(THREE.Geometry.prototype);
THREE.ExtrudeGeometry = function(a, b) {
    "undefined" !== typeof a && (THREE.Geometry.call(this), a = a instanceof Array ? a : [a], this.shapebb = a[a.length - 1].getBoundingBox(), this.addShapeList(a, b), this.computeFaceNormals())
};
THREE.ExtrudeGeometry.prototype = Object.create(THREE.Geometry.prototype);
THREE.ExtrudeGeometry.prototype.addShapeList = function(a, b) {
    for (var c = a.length, d = 0; d < c; d++) this.addShape(a[d], b)
};
THREE.ExtrudeGeometry.prototype.addShape = function(a, b) {
    function c(a, b, c) {
        b || console.log("die");
        return b.clone().multiplyScalar(c).add(a)
    }

    function d(a, b, c) {
        var d = THREE.Math.sign,
            e = 1,
            e = a.x - b.x,
            f = a.y - b.y,
            g = c.x - a.x,
            h = c.y - a.y,
            k = e * e + f * f;
        if (1E-10 < Math.abs(e * h - f * g)) {
            var l = Math.sqrt(k),
                d = Math.sqrt(g * g + h * h),
                k = b.x - f / l;
            b = b.y + e / l;
            g = ((c.x - h / d - k) * h - (c.y + g / d - b) * g) / (e * h - f * g);
            c = k + e * g - a.x;
            a = b + f * g - a.y;
            e = c * c + a * a;
            if (2 >= e) return new THREE.Vector2(c, a);
            e = Math.sqrt(e / 2)
        } else a = !1, 1E-10 < e ? 1E-10 < g && (a = !0) : -1E-10 > e ? -1E-10 > g &&
            (a = !0) : d(f) == d(h) && (a = !0), a ? (c = -f, a = e, e = Math.sqrt(k)) : (c = e, a = f, e = Math.sqrt(k / 2));
        return new THREE.Vector2(c / e, a / e)
    }

    function e(c, d) {
        var e, f;
        for (D = c.length; 0 <= --D;) {
            e = D;
            f = D - 1;
            0 > f && (f = c.length - 1);
            for (var g = 0, h = t + 2 * p, g = 0; g < h; g++) {
                var k = la * g,
                    l = la * (g + 1),
                    n = d + e + k,
                    k = d + f + k,
                    q = d + f + l,
                    l = d + e + l,
                    r = c,
                    s = g,
                    v = h,
                    w = e,
                    B = f,
                    n = n + Q,
                    k = k + Q,
                    q = q + Q,
                    l = l + Q;
                y.faces.push(new THREE.Face3(n, k, l, null, null, u));
                y.faces.push(new THREE.Face3(k, q, l, null, null, u));
                n = x.generateSideWallUV(y, a, r, b, n, k, q, l, s, v, w, B);
                y.faceVertexUvs[0].push([n[0], n[1],
                    n[3]
                ]);
                y.faceVertexUvs[0].push([n[1], n[2], n[3]])
            }
        }
    }

    function f(a, b, c) {
        y.vertices.push(new THREE.Vector3(a, b, c))
    }

    function g(c, d, e, f) {
        c += Q;
        d += Q;
        e += Q;
        y.faces.push(new THREE.Face3(c, d, e, null, null, w));
        c = f ? x.generateBottomUV(y, a, b, c, d, e) : x.generateTopUV(y, a, b, c, d, e);
        y.faceVertexUvs[0].push(c)
    }
    var h = void 0 !== b.amount ? b.amount : 100,
        k = void 0 !== b.bevelThickness ? b.bevelThickness : 6,
        l = void 0 !== b.bevelSize ? b.bevelSize : k - 2,
        p = void 0 !== b.bevelSegments ? b.bevelSegments : 3,
        q = void 0 !== b.bevelEnabled ? b.bevelEnabled : !0,
        r =
        void 0 !== b.curveSegments ? b.curveSegments : 12,
        t = void 0 !== b.steps ? b.steps : 1,
        s = b.extrudePath,
        n, v = !1,
        w = b.material,
        u = b.extrudeMaterial,
        x = void 0 !== b.UVGenerator ? b.UVGenerator : THREE.ExtrudeGeometry.WorldUVGenerator,
        K, A, G, B;
    s && (n = s.getSpacedPoints(t), v = !0, q = !1, K = void 0 !== b.frames ? b.frames : new THREE.TubeGeometry.FrenetFrames(s, t, !1), A = new THREE.Vector3, G = new THREE.Vector3, B = new THREE.Vector3);
    q || (l = k = p = 0);
    var C, E, H, y = this,
        Q = this.vertices.length,
        s = a.extractPoints(r),
        r = s.shape,
        z = s.holes;
    if (s = !THREE.Shape.Utils.isClockWise(r)) {
        r =
            r.reverse();
        E = 0;
        for (H = z.length; E < H; E++) C = z[E], THREE.Shape.Utils.isClockWise(C) && (z[E] = C.reverse());
        s = !1
    }
    var R = THREE.Shape.Utils.triangulateShape(r, z),
        L = r;
    E = 0;
    for (H = z.length; E < H; E++) C = z[E], r = r.concat(C);
    var I, F, P, X, N, la = r.length,
        S, W = R.length,
        s = [],
        D = 0;
    P = L.length;
    I = P - 1;
    for (F = D + 1; D < P; D++, I++, F++) I === P && (I = 0), F === P && (F = 0), s[D] = d(L[D], L[I], L[F]);
    var ha = [],
        fa, U = s.concat();
    E = 0;
    for (H = z.length; E < H; E++) {
        C = z[E];
        fa = [];
        D = 0;
        P = C.length;
        I = P - 1;
        for (F = D + 1; D < P; D++, I++, F++) I === P && (I = 0), F === P && (F = 0), fa[D] = d(C[D], C[I], C[F]);
        ha.push(fa);
        U = U.concat(fa)
    }
    for (I = 0; I < p; I++) {
        P = I / p;
        X = k * (1 - P);
        F = l * Math.sin(P * Math.PI / 2);
        D = 0;
        for (P = L.length; D < P; D++) N = c(L[D], s[D], F), f(N.x, N.y, -X);
        E = 0;
        for (H = z.length; E < H; E++)
            for (C = z[E], fa = ha[E], D = 0, P = C.length; D < P; D++) N = c(C[D], fa[D], F), f(N.x, N.y, -X)
    }
    F = l;
    for (D = 0; D < la; D++) N = q ? c(r[D], U[D], F) : r[D], v ? (G.copy(K.normals[0]).multiplyScalar(N.x), A.copy(K.binormals[0]).multiplyScalar(N.y), B.copy(n[0]).add(G).add(A), f(B.x, B.y, B.z)) : f(N.x, N.y, 0);
    for (P = 1; P <= t; P++)
        for (D = 0; D < la; D++) N = q ? c(r[D], U[D], F) : r[D], v ? (G.copy(K.normals[P]).multiplyScalar(N.x),
            A.copy(K.binormals[P]).multiplyScalar(N.y), B.copy(n[P]).add(G).add(A), f(B.x, B.y, B.z)) : f(N.x, N.y, h / t * P);
    for (I = p - 1; 0 <= I; I--) {
        P = I / p;
        X = k * (1 - P);
        F = l * Math.sin(P * Math.PI / 2);
        D = 0;
        for (P = L.length; D < P; D++) N = c(L[D], s[D], F), f(N.x, N.y, h + X);
        E = 0;
        for (H = z.length; E < H; E++)
            for (C = z[E], fa = ha[E], D = 0, P = C.length; D < P; D++) N = c(C[D], fa[D], F), v ? f(N.x, N.y + n[t - 1].y, n[t - 1].x + X) : f(N.x, N.y, h + X)
    }(function() {
        if (q) {
            var a;
            a = 0 * la;
            for (D = 0; D < W; D++) S = R[D], g(S[2] + a, S[1] + a, S[0] + a, !0);
            a = t + 2 * p;
            a *= la;
            for (D = 0; D < W; D++) S = R[D], g(S[0] + a, S[1] + a, S[2] + a, !1)
        } else {
            for (D = 0; D < W; D++) S = R[D], g(S[2], S[1], S[0], !0);
            for (D = 0; D < W; D++) S = R[D], g(S[0] + la * t, S[1] + la * t, S[2] + la * t, !1)
        }
    })();
    (function() {
        var a = 0;
        e(L, a);
        a += L.length;
        E = 0;
        for (H = z.length; E < H; E++) C = z[E], e(C, a), a += C.length
    })()
};
THREE.ExtrudeGeometry.WorldUVGenerator = {
    generateTopUV: function(a, b, c, d, e, f) {
        b = a.vertices[e].x;
        e = a.vertices[e].y;
        c = a.vertices[f].x;
        f = a.vertices[f].y;
        return [new THREE.Vector2(a.vertices[d].x, a.vertices[d].y), new THREE.Vector2(b, e), new THREE.Vector2(c, f)]
    },
    generateBottomUV: function(a, b, c, d, e, f) {
        return this.generateTopUV(a, b, c, d, e, f)
    },
    generateSideWallUV: function(a, b, c, d, e, f, g, h, k, l, p, q) {
        b = a.vertices[e].x;
        c = a.vertices[e].y;
        e = a.vertices[e].z;
        d = a.vertices[f].x;
        k = a.vertices[f].y;
        f = a.vertices[f].z;
        l = a.vertices[g].x;
        p = a.vertices[g].y;
        g = a.vertices[g].z;
        q = a.vertices[h].x;
        var r = a.vertices[h].y;
        a = a.vertices[h].z;
        return 0.01 > Math.abs(c - k) ? [new THREE.Vector2(b, 1 - e), new THREE.Vector2(d, 1 - f), new THREE.Vector2(l, 1 - g), new THREE.Vector2(q, 1 - a)] : [new THREE.Vector2(c, 1 - e), new THREE.Vector2(k, 1 - f), new THREE.Vector2(p, 1 - g), new THREE.Vector2(r, 1 - a)]
    }
};
THREE.ExtrudeGeometry.__v1 = new THREE.Vector2;
THREE.ExtrudeGeometry.__v2 = new THREE.Vector2;
THREE.ExtrudeGeometry.__v3 = new THREE.Vector2;
THREE.ExtrudeGeometry.__v4 = new THREE.Vector2;
THREE.ExtrudeGeometry.__v5 = new THREE.Vector2;
THREE.ExtrudeGeometry.__v6 = new THREE.Vector2;
THREE.ShapeGeometry = function(a, b) {
    THREE.Geometry.call(this);
    !1 === a instanceof Array && (a = [a]);
    this.shapebb = a[a.length - 1].getBoundingBox();
    this.addShapeList(a, b);
    this.computeFaceNormals()
};
THREE.ShapeGeometry.prototype = Object.create(THREE.Geometry.prototype);
THREE.ShapeGeometry.prototype.addShapeList = function(a, b) {
    for (var c = 0, d = a.length; c < d; c++) this.addShape(a[c], b);
    return this
};
THREE.ShapeGeometry.prototype.addShape = function(a, b) {
    void 0 === b && (b = {});
    var c = b.material,
        d = void 0 === b.UVGenerator ? THREE.ExtrudeGeometry.WorldUVGenerator : b.UVGenerator,
        e, f, g, h = this.vertices.length;
    e = a.extractPoints(void 0 !== b.curveSegments ? b.curveSegments : 12);
    var k = e.shape,
        l = e.holes;
    if (!THREE.Shape.Utils.isClockWise(k))
        for (k = k.reverse(), e = 0, f = l.length; e < f; e++) g = l[e], THREE.Shape.Utils.isClockWise(g) && (l[e] = g.reverse());
    var p = THREE.Shape.Utils.triangulateShape(k, l);
    e = 0;
    for (f = l.length; e < f; e++) g = l[e],
        k = k.concat(g);
    l = k.length;
    f = p.length;
    for (e = 0; e < l; e++) g = k[e], this.vertices.push(new THREE.Vector3(g.x, g.y, 0));
    for (e = 0; e < f; e++) l = p[e], k = l[0] + h, g = l[1] + h, l = l[2] + h, this.faces.push(new THREE.Face3(k, g, l, null, null, c)), this.faceVertexUvs[0].push(d.generateBottomUV(this, a, b, k, g, l))
};
THREE.LatheGeometry = function(a, b, c, d) {
    THREE.Geometry.call(this);
    b = b || 12;
    c = c || 0;
    d = d || 2 * Math.PI;
    for (var e = 1 / (a.length - 1), f = 1 / b, g = 0, h = b; g <= h; g++)
        for (var k = c + g * f * d, l = Math.cos(k), p = Math.sin(k), k = 0, q = a.length; k < q; k++) {
            var r = a[k],
                t = new THREE.Vector3;
            t.x = l * r.x - p * r.y;
            t.y = p * r.x + l * r.y;
            t.z = r.z;
            this.vertices.push(t)
        }
    c = a.length;
    g = 0;
    for (h = b; g < h; g++)
        for (k = 0, q = a.length - 1; k < q; k++) {
            b = p = k + c * g;
            d = p + c;
            var l = p + 1 + c,
                p = p + 1,
                r = g * f,
                t = k * e,
                s = r + f,
                n = t + e;
            this.faces.push(new THREE.Face3(b, d, p));
            this.faceVertexUvs[0].push([new THREE.Vector2(r,
                t), new THREE.Vector2(s, t), new THREE.Vector2(r, n)]);
            this.faces.push(new THREE.Face3(d, l, p));
            this.faceVertexUvs[0].push([new THREE.Vector2(s, t), new THREE.Vector2(s, n), new THREE.Vector2(r, n)])
        }
    this.mergeVertices();
    this.computeFaceNormals();
    this.computeVertexNormals()
};
THREE.LatheGeometry.prototype = Object.create(THREE.Geometry.prototype);
THREE.PlaneGeometry = function(a, b, c, d) {
    THREE.Geometry.call(this);
    this.parameters = {
        width: a,
        height: b,
        widthSegments: c,
        heightSegments: d
    };
    var e = a / 2,
        f = b / 2;
    c = c || 1;
    d = d || 1;
    var g = c + 1,
        h = d + 1,
        k = a / c,
        l = b / d,
        p = new THREE.Vector3(0, 0, 1);
    for (a = 0; a < h; a++) {
        var q = a * l - f;
        for (b = 0; b < g; b++) this.vertices.push(new THREE.Vector3(b * k - e, -q, 0))
    }
    for (a = 0; a < d; a++)
        for (b = 0; b < c; b++) {
            var r = b + g * a,
                e = b + g * (a + 1),
                f = b + 1 + g * (a + 1),
                h = b + 1 + g * a,
                k = new THREE.Vector2(b / c, 1 - a / d),
                l = new THREE.Vector2(b / c, 1 - (a + 1) / d),
                q = new THREE.Vector2((b + 1) / c, 1 - (a + 1) / d),
                t = new THREE.Vector2((b +
                    1) / c, 1 - a / d),
                r = new THREE.Face3(r, e, h);
            r.normal.copy(p);
            r.vertexNormals.push(p.clone(), p.clone(), p.clone());
            this.faces.push(r);
            this.faceVertexUvs[0].push([k, l, t]);
            r = new THREE.Face3(e, f, h);
            r.normal.copy(p);
            r.vertexNormals.push(p.clone(), p.clone(), p.clone());
            this.faces.push(r);
            this.faceVertexUvs[0].push([l.clone(), q, t.clone()])
        }
};
THREE.PlaneGeometry.prototype = Object.create(THREE.Geometry.prototype);
THREE.RingGeometry = function(a, b, c, d, e, f) {
    THREE.Geometry.call(this);
    a = a || 0;
    b = b || 50;
    e = void 0 !== e ? e : 0;
    f = void 0 !== f ? f : 2 * Math.PI;
    c = void 0 !== c ? Math.max(3, c) : 8;
    d = void 0 !== d ? Math.max(1, d) : 8;
    var g, h = [],
        k = a,
        l = (b - a) / d;
    for (a = 0; a < d + 1; a++) {
        for (g = 0; g < c + 1; g++) {
            var p = new THREE.Vector3,
                q = e + g / c * f;
            p.x = k * Math.cos(q);
            p.y = k * Math.sin(q);
            this.vertices.push(p);
            h.push(new THREE.Vector2((p.x / b + 1) / 2, (p.y / b + 1) / 2))
        }
        k += l
    }
    b = new THREE.Vector3(0, 0, 1);
    for (a = 0; a < d; a++)
        for (e = a * (c + 1), g = 0; g < c; g++) f = q = g + e, l = q + c + 1, p = q + c + 2, this.faces.push(new THREE.Face3(f,
            l, p, [b.clone(), b.clone(), b.clone()])), this.faceVertexUvs[0].push([h[f].clone(), h[l].clone(), h[p].clone()]), f = q, l = q + c + 2, p = q + 1, this.faces.push(new THREE.Face3(f, l, p, [b.clone(), b.clone(), b.clone()])), this.faceVertexUvs[0].push([h[f].clone(), h[l].clone(), h[p].clone()]);
    this.computeFaceNormals();
    this.boundingSphere = new THREE.Sphere(new THREE.Vector3, k)
};
THREE.RingGeometry.prototype = Object.create(THREE.Geometry.prototype);
THREE.SphereGeometry = function(a, b, c, d, e, f, g) {
    THREE.Geometry.call(this);
    this.parameters = {
        radius: a,
        widthSegments: b,
        heightSegments: c,
        phiStart: d,
        phiLength: e,
        thetaStart: f,
        thetaLength: g
    };
    a = a || 50;
    b = Math.max(3, Math.floor(b) || 8);
    c = Math.max(2, Math.floor(c) || 6);
    d = void 0 !== d ? d : 0;
    e = void 0 !== e ? e : 2 * Math.PI;
    f = void 0 !== f ? f : 0;
    g = void 0 !== g ? g : Math.PI;
    var h, k, l = [],
        p = [];
    for (k = 0; k <= c; k++) {
        var q = [],
            r = [];
        for (h = 0; h <= b; h++) {
            var t = h / b,
                s = k / c,
                n = new THREE.Vector3;
            n.x = -a * Math.cos(d + t * e) * Math.sin(f + s * g);
            n.y = a * Math.cos(f + s * g);
            n.z =
                a * Math.sin(d + t * e) * Math.sin(f + s * g);
            this.vertices.push(n);
            q.push(this.vertices.length - 1);
            r.push(new THREE.Vector2(t, 1 - s))
        }
        l.push(q);
        p.push(r)
    }
    for (k = 0; k < c; k++)
        for (h = 0; h < b; h++) {
            d = l[k][h + 1];
            e = l[k][h];
            f = l[k + 1][h];
            g = l[k + 1][h + 1];
            var q = this.vertices[d].clone().normalize(),
                r = this.vertices[e].clone().normalize(),
                t = this.vertices[f].clone().normalize(),
                s = this.vertices[g].clone().normalize(),
                n = p[k][h + 1].clone(),
                v = p[k][h].clone(),
                w = p[k + 1][h].clone(),
                u = p[k + 1][h + 1].clone();
            Math.abs(this.vertices[d].y) === a ? (n.x = (n.x +
                v.x) / 2, this.faces.push(new THREE.Face3(d, f, g, [q, t, s])), this.faceVertexUvs[0].push([n, w, u])) : Math.abs(this.vertices[f].y) === a ? (w.x = (w.x + u.x) / 2, this.faces.push(new THREE.Face3(d, e, f, [q, r, t])), this.faceVertexUvs[0].push([n, v, w])) : (this.faces.push(new THREE.Face3(d, e, g, [q, r, s])), this.faceVertexUvs[0].push([n, v, u]), this.faces.push(new THREE.Face3(e, f, g, [r.clone(), t, s.clone()])), this.faceVertexUvs[0].push([v.clone(), w, u.clone()]))
        }
    this.computeFaceNormals();
    this.boundingSphere = new THREE.Sphere(new THREE.Vector3,
        a)
};
THREE.SphereGeometry.prototype = Object.create(THREE.Geometry.prototype);
THREE.TextGeometry = function(a, b) {
    b = b || {};
    var c = THREE.FontUtils.generateShapes(a, b);
    b.amount = void 0 !== b.height ? b.height : 50;
    void 0 === b.bevelThickness && (b.bevelThickness = 10);
    void 0 === b.bevelSize && (b.bevelSize = 8);
    void 0 === b.bevelEnabled && (b.bevelEnabled = !1);
    THREE.ExtrudeGeometry.call(this, c, b)
};
THREE.TextGeometry.prototype = Object.create(THREE.ExtrudeGeometry.prototype);
THREE.TorusGeometry = function(a, b, c, d, e) {
    THREE.Geometry.call(this);
    this.parameters = {
        radius: a,
        tube: b,
        radialSegments: c,
        tubularSegments: d,
        arc: e
    };
    a = a || 100;
    b = b || 40;
    c = c || 8;
    d = d || 6;
    e = e || 2 * Math.PI;
    for (var f = new THREE.Vector3, g = [], h = [], k = 0; k <= c; k++)
        for (var l = 0; l <= d; l++) {
            var p = l / d * e,
                q = k / c * Math.PI * 2;
            f.x = a * Math.cos(p);
            f.y = a * Math.sin(p);
            var r = new THREE.Vector3;
            r.x = (a + b * Math.cos(q)) * Math.cos(p);
            r.y = (a + b * Math.cos(q)) * Math.sin(p);
            r.z = b * Math.sin(q);
            this.vertices.push(r);
            g.push(new THREE.Vector2(l / d, k / c));
            h.push(r.clone().sub(f).normalize())
        }
    for (k =
        1; k <= c; k++)
        for (l = 1; l <= d; l++) a = (d + 1) * k + l - 1, b = (d + 1) * (k - 1) + l - 1, e = (d + 1) * (k - 1) + l, f = (d + 1) * k + l, p = new THREE.Face3(a, b, f, [h[a].clone(), h[b].clone(), h[f].clone()]), this.faces.push(p), this.faceVertexUvs[0].push([g[a].clone(), g[b].clone(), g[f].clone()]), p = new THREE.Face3(b, e, f, [h[b].clone(), h[e].clone(), h[f].clone()]), this.faces.push(p), this.faceVertexUvs[0].push([g[b].clone(), g[e].clone(), g[f].clone()]);
    this.computeFaceNormals()
};
THREE.TorusGeometry.prototype = Object.create(THREE.Geometry.prototype);
THREE.TorusKnotGeometry = function(a, b, c, d, e, f, g) {
    function h(a, b, c, d, e) {
        var f = Math.cos(a),
            g = Math.sin(a);
        a *= b / c;
        b = Math.cos(a);
        f *= d * (2 + b) * 0.5;
        g = d * (2 + b) * g * 0.5;
        d = e * d * Math.sin(a) * 0.5;
        return new THREE.Vector3(f, g, d)
    }
    THREE.Geometry.call(this);
    this.parameters = {
        radius: a,
        tube: b,
        radialSegments: c,
        tubularSegments: d,
        p: e,
        q: f,
        heightScale: g
    };
    a = a || 100;
    b = b || 40;
    c = c || 64;
    d = d || 8;
    e = e || 2;
    f = f || 3;
    g = g || 1;
    for (var k = Array(c), l = new THREE.Vector3, p = new THREE.Vector3, q = new THREE.Vector3, r = 0; r < c; ++r) {
        k[r] = Array(d);
        var t = r / c * 2 * e * Math.PI,
            s = h(t, f, e, a, g),
            t = h(t + 0.01, f, e, a, g);
        l.subVectors(t, s);
        p.addVectors(t, s);
        q.crossVectors(l, p);
        p.crossVectors(q, l);
        q.normalize();
        p.normalize();
        for (t = 0; t < d; ++t) {
            var n = t / d * 2 * Math.PI,
                v = -b * Math.cos(n),
                n = b * Math.sin(n),
                w = new THREE.Vector3;
            w.x = s.x + v * p.x + n * q.x;
            w.y = s.y + v * p.y + n * q.y;
            w.z = s.z + v * p.z + n * q.z;
            k[r][t] = this.vertices.push(w) - 1
        }
    }
    for (r = 0; r < c; ++r)
        for (t = 0; t < d; ++t) e = (r + 1) % c, f = (t + 1) % d, a = k[r][t], b = k[e][t], e = k[e][f], f = k[r][f], g = new THREE.Vector2(r / c, t / d), l = new THREE.Vector2((r + 1) / c, t / d), p = new THREE.Vector2((r + 1) /
            c, (t + 1) / d), q = new THREE.Vector2(r / c, (t + 1) / d), this.faces.push(new THREE.Face3(a, b, f)), this.faceVertexUvs[0].push([g, l, q]), this.faces.push(new THREE.Face3(b, e, f)), this.faceVertexUvs[0].push([l.clone(), p, q.clone()]);
    this.computeFaceNormals();
    this.computeVertexNormals()
};
THREE.TorusKnotGeometry.prototype = Object.create(THREE.Geometry.prototype);
THREE.TubeGeometry = function(a, b, c, d, e) {
    THREE.Geometry.call(this);
    this.parameters = {
        path: a,
        segments: b,
        radius: c,
        radialSegments: d,
        closed: e
    };
    b = b || 64;
    c = c || 1;
    d = d || 8;
    e = e || !1;
    var f = [],
        g, h, k = b + 1,
        l, p, q, r, t = new THREE.Vector3,
        s, n, v;
    s = new THREE.TubeGeometry.FrenetFrames(a, b, e);
    n = s.normals;
    v = s.binormals;
    this.tangents = s.tangents;
    this.normals = n;
    this.binormals = v;
    for (s = 0; s < k; s++)
        for (f[s] = [], l = s / (k - 1), r = a.getPointAt(l), g = n[s], h = v[s], l = 0; l < d; l++) p = l / d * 2 * Math.PI, q = -c * Math.cos(p), p = c * Math.sin(p), t.copy(r), t.x += q * g.x + p *
            h.x, t.y += q * g.y + p * h.y, t.z += q * g.z + p * h.z, f[s][l] = this.vertices.push(new THREE.Vector3(t.x, t.y, t.z)) - 1;
    for (s = 0; s < b; s++)
        for (l = 0; l < d; l++) k = e ? (s + 1) % b : s + 1, t = (l + 1) % d, a = f[s][l], c = f[k][l], k = f[k][t], t = f[s][t], n = new THREE.Vector2(s / b, l / d), v = new THREE.Vector2((s + 1) / b, l / d), g = new THREE.Vector2((s + 1) / b, (l + 1) / d), h = new THREE.Vector2(s / b, (l + 1) / d), this.faces.push(new THREE.Face3(a, c, t)), this.faceVertexUvs[0].push([n, v, h]), this.faces.push(new THREE.Face3(c, k, t)), this.faceVertexUvs[0].push([v.clone(), g, h.clone()]);
    this.computeFaceNormals();
    this.computeVertexNormals()
};
THREE.TubeGeometry.prototype = Object.create(THREE.Geometry.prototype);
THREE.TubeGeometry.FrenetFrames = function(a, b, c) {
    new THREE.Vector3;
    var d = new THREE.Vector3;
    new THREE.Vector3;
    var e = [],
        f = [],
        g = [],
        h = new THREE.Vector3,
        k = new THREE.Matrix4;
    b += 1;
    var l, p, q;
    this.tangents = e;
    this.normals = f;
    this.binormals = g;
    for (l = 0; l < b; l++) p = l / (b - 1), e[l] = a.getTangentAt(p), e[l].normalize();
    f[0] = new THREE.Vector3;
    g[0] = new THREE.Vector3;
    a = Number.MAX_VALUE;
    l = Math.abs(e[0].x);
    p = Math.abs(e[0].y);
    q = Math.abs(e[0].z);
    l <= a && (a = l, d.set(1, 0, 0));
    p <= a && (a = p, d.set(0, 1, 0));
    q <= a && d.set(0, 0, 1);
    h.crossVectors(e[0],
        d).normalize();
    f[0].crossVectors(e[0], h);
    g[0].crossVectors(e[0], f[0]);
    for (l = 1; l < b; l++) f[l] = f[l - 1].clone(), g[l] = g[l - 1].clone(), h.crossVectors(e[l - 1], e[l]), 1E-4 < h.length() && (h.normalize(), d = Math.acos(THREE.Math.clamp(e[l - 1].dot(e[l]), -1, 1)), f[l].applyMatrix4(k.makeRotationAxis(h, d))), g[l].crossVectors(e[l], f[l]);
    if (c)
        for (d = Math.acos(THREE.Math.clamp(f[0].dot(f[b - 1]), -1, 1)), d /= b - 1, 0 < e[0].dot(h.crossVectors(f[0], f[b - 1])) && (d = -d), l = 1; l < b; l++) f[l].applyMatrix4(k.makeRotationAxis(e[l], d * l)), g[l].crossVectors(e[l],
            f[l])
};
THREE.PolyhedronGeometry = function(a, b, c, d) {
    function e(a) {
        var b = a.normalize().clone();
        b.index = k.vertices.push(b) - 1;
        var c = Math.atan2(a.z, -a.x) / 2 / Math.PI + 0.5;
        a = Math.atan2(-a.y, Math.sqrt(a.x * a.x + a.z * a.z)) / Math.PI + 0.5;
        b.uv = new THREE.Vector2(c, 1 - a);
        return b
    }

    function f(a, b, c) {
        var d = new THREE.Face3(a.index, b.index, c.index, [a.clone(), b.clone(), c.clone()]);
        k.faces.push(d);
        v.copy(a).add(b).add(c).divideScalar(3);
        d = Math.atan2(v.z, -v.x);
        k.faceVertexUvs[0].push([h(a.uv, a, d), h(b.uv, b, d), h(c.uv, c, d)])
    }

    function g(a,
        b) {
        var c = Math.pow(2, b);
        Math.pow(4, b);
        for (var d = e(k.vertices[a.a]), g = e(k.vertices[a.b]), h = e(k.vertices[a.c]), l = [], n = 0; n <= c; n++) {
            l[n] = [];
            for (var p = e(d.clone().lerp(h, n / c)), q = e(g.clone().lerp(h, n / c)), r = c - n, s = 0; s <= r; s++) l[n][s] = 0 == s && n == c ? p : e(p.clone().lerp(q, s / r))
        }
        for (n = 0; n < c; n++)
            for (s = 0; s < 2 * (c - n) - 1; s++) d = Math.floor(s / 2), 0 == s % 2 ? f(l[n][d + 1], l[n + 1][d], l[n][d]) : f(l[n][d + 1], l[n + 1][d + 1], l[n + 1][d])
    }

    function h(a, b, c) {
        0 > c && 1 === a.x && (a = new THREE.Vector2(a.x - 1, a.y));
        0 === b.x && 0 === b.z && (a = new THREE.Vector2(c / 2 /
            Math.PI + 0.5, a.y));
        return a.clone()
    }
    THREE.Geometry.call(this);
    c = c || 1;
    d = d || 0;
    for (var k = this, l = 0, p = a.length; l < p; l += 3) e(new THREE.Vector3(a[l], a[l + 1], a[l + 2]));
    a = this.vertices;
    for (var q = [], r = l = 0, p = b.length; l < p; l += 3, r++) {
        var t = a[b[l]],
            s = a[b[l + 1]],
            n = a[b[l + 2]];
        q[r] = new THREE.Face3(t.index, s.index, n.index, [t.clone(), s.clone(), n.clone()])
    }
    for (var v = new THREE.Vector3, l = 0, p = q.length; l < p; l++) g(q[l], d);
    l = 0;
    for (p = this.faceVertexUvs[0].length; l < p; l++) b = this.faceVertexUvs[0][l], d = b[0].x, a = b[1].x, q = b[2].x, r = Math.max(d,
        Math.max(a, q)), t = Math.min(d, Math.min(a, q)), 0.9 < r && 0.1 > t && (0.2 > d && (b[0].x += 1), 0.2 > a && (b[1].x += 1), 0.2 > q && (b[2].x += 1));
    l = 0;
    for (p = this.vertices.length; l < p; l++) this.vertices[l].multiplyScalar(c);
    this.mergeVertices();
    this.computeFaceNormals();
    this.boundingSphere = new THREE.Sphere(new THREE.Vector3, c)
};
THREE.PolyhedronGeometry.prototype = Object.create(THREE.Geometry.prototype);
THREE.IcosahedronGeometry = function(a, b) {
    this.parameters = {
        radius: a,
        detail: b
    };
    var c = (1 + Math.sqrt(5)) / 2;
    THREE.PolyhedronGeometry.call(this, [-1, c, 0, 1, c, 0, -1, -c, 0, 1, -c, 0, 0, -1, c, 0, 1, c, 0, -1, -c, 0, 1, -c, c, 0, -1, c, 0, 1, -c, 0, -1, -c, 0, 1], [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1], a, b)
};
THREE.IcosahedronGeometry.prototype = Object.create(THREE.Geometry.prototype);
THREE.OctahedronGeometry = function(a, b) {
    this.parameters = {
        radius: a,
        detail: b
    };
    THREE.PolyhedronGeometry.call(this, [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1], [0, 2, 4, 0, 4, 3, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 3, 1, 3, 4, 1, 4, 2], a, b)
};
THREE.OctahedronGeometry.prototype = Object.create(THREE.Geometry.prototype);
THREE.TetrahedronGeometry = function(a, b) {
    THREE.PolyhedronGeometry.call(this, [1, 1, 1, -1, -1, 1, -1, 1, -1, 1, -1, -1], [2, 1, 0, 0, 3, 2, 1, 3, 0, 2, 3, 1], a, b)
};
THREE.TetrahedronGeometry.prototype = Object.create(THREE.Geometry.prototype);
THREE.ParametricGeometry = function(a, b, c) {
    THREE.Geometry.call(this);
    var d = this.vertices,
        e = this.faces,
        f = this.faceVertexUvs[0],
        g, h, k, l, p = b + 1;
    for (g = 0; g <= c; g++)
        for (l = g / c, h = 0; h <= b; h++) k = h / b, k = a(k, l), d.push(k);
    var q, r, t, s;
    for (g = 0; g < c; g++)
        for (h = 0; h < b; h++) a = g * p + h, d = g * p + h + 1, l = (g + 1) * p + h + 1, k = (g + 1) * p + h, q = new THREE.Vector2(h / b, g / c), r = new THREE.Vector2((h + 1) / b, g / c), t = new THREE.Vector2((h + 1) / b, (g + 1) / c), s = new THREE.Vector2(h / b, (g + 1) / c), e.push(new THREE.Face3(a, d, k)), f.push([q, r, s]), e.push(new THREE.Face3(d, l, k)),
            f.push([r.clone(), t, s.clone()]);
    this.computeFaceNormals();
    this.computeVertexNormals()
};
THREE.ParametricGeometry.prototype = Object.create(THREE.Geometry.prototype);
THREE.AxisHelper = function(a) {
    a = a || 1;
    var b = new Float32Array([0, 0, 0, a, 0, 0, 0, 0, 0, 0, a, 0, 0, 0, 0, 0, 0, a]),
        c = new Float32Array([1, 0, 0, 1, 0.6, 0, 0, 1, 0, 0.6, 1, 0, 0, 0, 1, 0, 0.6, 1]);
    a = new THREE.BufferGeometry;
    a.addAttribute("position", new THREE.BufferAttribute(b, 3));
    a.addAttribute("color", new THREE.BufferAttribute(c, 3));
    b = new THREE.LineBasicMaterial({
        vertexColors: THREE.VertexColors
    });
    THREE.Line.call(this, a, b, THREE.LinePieces)
};
THREE.AxisHelper.prototype = Object.create(THREE.Line.prototype);
THREE.ArrowHelper = function() {
    var a = new THREE.Geometry;
    a.vertices.push(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
    var b = new THREE.CylinderGeometry(0, 0.5, 1, 5, 1);
    b.applyMatrix((new THREE.Matrix4).makeTranslation(0, -0.5, 0));
    return function(c, d, e, f, g, h) {
        THREE.Object3D.call(this);
        void 0 === f && (f = 16776960);
        void 0 === e && (e = 1);
        void 0 === g && (g = 0.2 * e);
        void 0 === h && (h = 0.2 * g);
        this.position.copy(d);
        this.line = new THREE.Line(a, new THREE.LineBasicMaterial({
            color: f
        }));
        this.line.matrixAutoUpdate = !1;
        this.add(this.line);
        this.cone = new THREE.Mesh(b, new THREE.MeshBasicMaterial({
            color: f
        }));
        this.cone.matrixAutoUpdate = !1;
        this.add(this.cone);
        this.setDirection(c);
        this.setLength(e, g, h)
    }
}();
THREE.ArrowHelper.prototype = Object.create(THREE.Object3D.prototype);
THREE.ArrowHelper.prototype.setDirection = function() {
    var a = new THREE.Vector3,
        b;
    return function(c) {
        0.99999 < c.y ? this.quaternion.set(0, 0, 0, 1) : -0.99999 > c.y ? this.quaternion.set(1, 0, 0, 0) : (a.set(c.z, 0, -c.x).normalize(), b = Math.acos(c.y), this.quaternion.setFromAxisAngle(a, b))
    }
}();
THREE.ArrowHelper.prototype.setLength = function(a, b, c) {
    void 0 === b && (b = 0.2 * a);
    void 0 === c && (c = 0.2 * b);
    this.line.scale.set(1, a, 1);
    this.line.updateMatrix();
    this.cone.scale.set(c, b, c);
    this.cone.position.y = a;
    this.cone.updateMatrix()
};
THREE.ArrowHelper.prototype.setColor = function(a) {
    this.line.material.color.set(a);
    this.cone.material.color.set(a)
};
THREE.BoxHelper = function(a) {
    var b = new THREE.BufferGeometry;
    b.addAttribute("position", new THREE.BufferAttribute(new Float32Array(72), 3));
    THREE.Line.call(this, b, new THREE.LineBasicMaterial({
        color: 16776960
    }), THREE.LinePieces);
    void 0 !== a && this.update(a)
};
THREE.BoxHelper.prototype = Object.create(THREE.Line.prototype);
THREE.BoxHelper.prototype.update = function(a) {
    var b = a.geometry;
    null === b.boundingBox && b.computeBoundingBox();
    var c = b.boundingBox.min,
        b = b.boundingBox.max,
        d = this.geometry.attributes.position.array;
    d[0] = b.x;
    d[1] = b.y;
    d[2] = b.z;
    d[3] = c.x;
    d[4] = b.y;
    d[5] = b.z;
    d[6] = c.x;
    d[7] = b.y;
    d[8] = b.z;
    d[9] = c.x;
    d[10] = c.y;
    d[11] = b.z;
    d[12] = c.x;
    d[13] = c.y;
    d[14] = b.z;
    d[15] = b.x;
    d[16] = c.y;
    d[17] = b.z;
    d[18] = b.x;
    d[19] = c.y;
    d[20] = b.z;
    d[21] = b.x;
    d[22] = b.y;
    d[23] = b.z;
    d[24] = b.x;
    d[25] = b.y;
    d[26] = c.z;
    d[27] = c.x;
    d[28] = b.y;
    d[29] = c.z;
    d[30] = c.x;
    d[31] = b.y;
    d[32] = c.z;
    d[33] = c.x;
    d[34] = c.y;
    d[35] = c.z;
    d[36] = c.x;
    d[37] = c.y;
    d[38] = c.z;
    d[39] = b.x;
    d[40] = c.y;
    d[41] = c.z;
    d[42] = b.x;
    d[43] = c.y;
    d[44] = c.z;
    d[45] = b.x;
    d[46] = b.y;
    d[47] = c.z;
    d[48] = b.x;
    d[49] = b.y;
    d[50] = b.z;
    d[51] = b.x;
    d[52] = b.y;
    d[53] = c.z;
    d[54] = c.x;
    d[55] = b.y;
    d[56] = b.z;
    d[57] = c.x;
    d[58] = b.y;
    d[59] = c.z;
    d[60] = c.x;
    d[61] = c.y;
    d[62] = b.z;
    d[63] = c.x;
    d[64] = c.y;
    d[65] = c.z;
    d[66] = b.x;
    d[67] = c.y;
    d[68] = b.z;
    d[69] = b.x;
    d[70] = c.y;
    d[71] = c.z;
    this.geometry.attributes.position.needsUpdate = !0;
    this.geometry.computeBoundingSphere();
    this.matrixAutoUpdate = !1;
    this.matrixWorld = a.matrixWorld
};
THREE.BoundingBoxHelper = function(a, b) {
    var c = void 0 !== b ? b : 8947848;
    this.object = a;
    this.box = new THREE.Box3;
    THREE.Mesh.call(this, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({
        color: c,
        wireframe: !0
    }))
};
THREE.BoundingBoxHelper.prototype = Object.create(THREE.Mesh.prototype);
THREE.BoundingBoxHelper.prototype.update = function() {
    this.box.setFromObject(this.object);
    this.box.size(this.scale);
    this.box.center(this.position)
};
THREE.CameraHelper = function(a) {
    function b(a, b, d) {
        c(a, d);
        c(b, d)
    }

    function c(a, b) {
        d.vertices.push(new THREE.Vector3);
        d.colors.push(new THREE.Color(b));
        void 0 === f[a] && (f[a] = []);
        f[a].push(d.vertices.length - 1)
    }
    var d = new THREE.Geometry,
        e = new THREE.LineBasicMaterial({
            color: 16777215,
            vertexColors: THREE.FaceColors
        }),
        f = {};
    b("n1", "n2", 16755200);
    b("n2", "n4", 16755200);
    b("n4", "n3", 16755200);
    b("n3", "n1", 16755200);
    b("f1", "f2", 16755200);
    b("f2", "f4", 16755200);
    b("f4", "f3", 16755200);
    b("f3", "f1", 16755200);
    b("n1", "f1", 16755200);
    b("n2", "f2", 16755200);
    b("n3", "f3", 16755200);
    b("n4", "f4", 16755200);
    b("p", "n1", 16711680);
    b("p", "n2", 16711680);
    b("p", "n3", 16711680);
    b("p", "n4", 16711680);
    b("u1", "u2", 43775);
    b("u2", "u3", 43775);
    b("u3", "u1", 43775);
    b("c", "t", 16777215);
    b("p", "c", 3355443);
    b("cn1", "cn2", 3355443);
    b("cn3", "cn4", 3355443);
    b("cf1", "cf2", 3355443);
    b("cf3", "cf4", 3355443);
    THREE.Line.call(this, d, e, THREE.LinePieces);
    this.camera = a;
    this.matrixWorld = a.matrixWorld;
    this.matrixAutoUpdate = !1;
    this.pointMap = f;
    this.update()
};
THREE.CameraHelper.prototype = Object.create(THREE.Line.prototype);
THREE.CameraHelper.prototype.update = function() {
    var a = new THREE.Vector3,
        b = new THREE.Camera,
        c = new THREE.Projector;
    return function() {
        function d(d, g, h, k) {
            a.set(g, h, k);
            c.unprojectVector(a, b);
            d = e.pointMap[d];
            if (void 0 !== d)
                for (g = 0, h = d.length; g < h; g++) e.geometry.vertices[d[g]].copy(a)
        }
        var e = this;
        b.projectionMatrix.copy(this.camera.projectionMatrix);
        d("c", 0, 0, -1);
        d("t", 0, 0, 1);
        d("n1", -1, -1, -1);
        d("n2", 1, -1, -1);
        d("n3", -1, 1, -1);
        d("n4", 1, 1, -1);
        d("f1", -1, -1, 1);
        d("f2", 1, -1, 1);
        d("f3", -1, 1, 1);
        d("f4", 1, 1, 1);
        d("u1", 0.7,
            1.1, -1);
        d("u2", -0.7, 1.1, -1);
        d("u3", 0, 2, -1);
        d("cf1", -1, 0, 1);
        d("cf2", 1, 0, 1);
        d("cf3", 0, -1, 1);
        d("cf4", 0, 1, 1);
        d("cn1", -1, 0, -1);
        d("cn2", 1, 0, -1);
        d("cn3", 0, -1, -1);
        d("cn4", 0, 1, -1);
        this.geometry.verticesNeedUpdate = !0
    }
}();
THREE.DirectionalLightHelper = function(a, b) {
    THREE.Object3D.call(this);
    this.light = a;
    this.light.updateMatrixWorld();
    this.matrixWorld = a.matrixWorld;
    this.matrixAutoUpdate = !1;
    b = b || 1;
    var c = new THREE.Geometry;
    c.vertices.push(new THREE.Vector3(-b, b, 0), new THREE.Vector3(b, b, 0), new THREE.Vector3(b, -b, 0), new THREE.Vector3(-b, -b, 0), new THREE.Vector3(-b, b, 0));
    var d = new THREE.LineBasicMaterial({
        fog: !1
    });
    d.color.copy(this.light.color).multiplyScalar(this.light.intensity);
    this.lightPlane = new THREE.Line(c, d);
    this.add(this.lightPlane);
    c = new THREE.Geometry;
    c.vertices.push(new THREE.Vector3, new THREE.Vector3);
    d = new THREE.LineBasicMaterial({
        fog: !1
    });
    d.color.copy(this.light.color).multiplyScalar(this.light.intensity);
    this.targetLine = new THREE.Line(c, d);
    this.add(this.targetLine);
    this.update()
};
THREE.DirectionalLightHelper.prototype = Object.create(THREE.Object3D.prototype);
THREE.DirectionalLightHelper.prototype.dispose = function() {
    this.lightPlane.geometry.dispose();
    this.lightPlane.material.dispose();
    this.targetLine.geometry.dispose();
    this.targetLine.material.dispose()
};
THREE.DirectionalLightHelper.prototype.update = function() {
    var a = new THREE.Vector3,
        b = new THREE.Vector3,
        c = new THREE.Vector3;
    return function() {
        a.setFromMatrixPosition(this.light.matrixWorld);
        b.setFromMatrixPosition(this.light.target.matrixWorld);
        c.subVectors(b, a);
        this.lightPlane.lookAt(c);
        this.lightPlane.material.color.copy(this.light.color).multiplyScalar(this.light.intensity);
        this.targetLine.geometry.vertices[1].copy(c);
        this.targetLine.geometry.verticesNeedUpdate = !0;
        this.targetLine.material.color.copy(this.lightPlane.material.color)
    }
}();
THREE.EdgesHelper = function(a, b) {
    var c = void 0 !== b ? b : 16777215,
        d = [0, 0],
        e = {},
        f = function(a, b) {
            return a - b
        },
        g = ["a", "b", "c"],
        h = new THREE.BufferGeometry,
        k = a.geometry.clone();
    k.mergeVertices();
    k.computeFaceNormals();
    for (var l = k.vertices, k = k.faces, p = 0, q = 0, r = k.length; q < r; q++)
        for (var t = k[q], s = 0; 3 > s; s++) {
            d[0] = t[g[s]];
            d[1] = t[g[(s + 1) % 3]];
            d.sort(f);
            var n = d.toString();
            void 0 === e[n] ? (e[n] = {
                vert1: d[0],
                vert2: d[1],
                face1: q,
                face2: void 0
            }, p++) : e[n].face2 = q
        }
    h.addAttribute("position", new THREE.Float32Attribute(6 * p, 3));
    d = h.attributes.position.array;
    f = 0;
    for (n in e)
        if (g = e[n], void 0 === g.face2 || 0.9999 > k[g.face1].normal.dot(k[g.face2].normal)) p = l[g.vert1], d[f++] = p.x, d[f++] = p.y, d[f++] = p.z, p = l[g.vert2], d[f++] = p.x, d[f++] = p.y, d[f++] = p.z;
    THREE.Line.call(this, h, new THREE.LineBasicMaterial({
        color: c
    }), THREE.LinePieces);
    this.matrixAutoUpdate = !1;
    this.matrixWorld = a.matrixWorld
};
THREE.EdgesHelper.prototype = Object.create(THREE.Line.prototype);
THREE.FaceNormalsHelper = function(a, b, c, d) {
    this.object = a;
    this.size = void 0 !== b ? b : 1;
    a = void 0 !== c ? c : 16776960;
    d = void 0 !== d ? d : 1;
    b = new THREE.Geometry;
    c = 0;
    for (var e = this.object.geometry.faces.length; c < e; c++) b.vertices.push(new THREE.Vector3, new THREE.Vector3);
    THREE.Line.call(this, b, new THREE.LineBasicMaterial({
        color: a,
        linewidth: d
    }), THREE.LinePieces);
    this.matrixAutoUpdate = !1;
    this.normalMatrix = new THREE.Matrix3;
    this.update()
};
THREE.FaceNormalsHelper.prototype = Object.create(THREE.Line.prototype);
THREE.FaceNormalsHelper.prototype.update = function() {
    var a = this.geometry.vertices,
        b = this.object,
        c = b.geometry.vertices,
        d = b.geometry.faces,
        e = b.matrixWorld;
    b.updateMatrixWorld(!0);
    this.normalMatrix.getNormalMatrix(e);
    for (var f = b = 0, g = d.length; b < g; b++, f += 2) {
        var h = d[b];
        a[f].copy(c[h.a]).add(c[h.b]).add(c[h.c]).divideScalar(3).applyMatrix4(e);
        a[f + 1].copy(h.normal).applyMatrix3(this.normalMatrix).normalize().multiplyScalar(this.size).add(a[f])
    }
    this.geometry.verticesNeedUpdate = !0;
    return this
};
THREE.GridHelper = function(a, b) {
    var c = new THREE.Geometry,
        d = new THREE.LineBasicMaterial({
            vertexColors: THREE.VertexColors
        });
    this.color1 = new THREE.Color(4473924);
    this.color2 = new THREE.Color(8947848);
    for (var e = -a; e <= a; e += b) {
        c.vertices.push(new THREE.Vector3(-a, 0, e), new THREE.Vector3(a, 0, e), new THREE.Vector3(e, 0, -a), new THREE.Vector3(e, 0, a));
        var f = 0 === e ? this.color1 : this.color2;
        c.colors.push(f, f, f, f)
    }
    THREE.Line.call(this, c, d, THREE.LinePieces)
};
THREE.GridHelper.prototype = Object.create(THREE.Line.prototype);
THREE.GridHelper.prototype.setColors = function(a, b) {
    this.color1.set(a);
    this.color2.set(b);
    this.geometry.colorsNeedUpdate = !0
};
THREE.HemisphereLightHelper = function(a, b, c, d) {
    THREE.Object3D.call(this);
    this.light = a;
    this.light.updateMatrixWorld();
    this.matrixWorld = a.matrixWorld;
    this.matrixAutoUpdate = !1;
    this.colors = [new THREE.Color, new THREE.Color];
    a = new THREE.SphereGeometry(b, 4, 2);
    a.applyMatrix((new THREE.Matrix4).makeRotationX(-Math.PI / 2));
    for (b = 0; 8 > b; b++) a.faces[b].color = this.colors[4 > b ? 0 : 1];
    b = new THREE.MeshBasicMaterial({
        vertexColors: THREE.FaceColors,
        wireframe: !0
    });
    this.lightSphere = new THREE.Mesh(a, b);
    this.add(this.lightSphere);
    this.update()
};
THREE.HemisphereLightHelper.prototype = Object.create(THREE.Object3D.prototype);
THREE.HemisphereLightHelper.prototype.dispose = function() {
    this.lightSphere.geometry.dispose();
    this.lightSphere.material.dispose()
};
THREE.HemisphereLightHelper.prototype.update = function() {
    var a = new THREE.Vector3;
    return function() {
        this.colors[0].copy(this.light.color).multiplyScalar(this.light.intensity);
        this.colors[1].copy(this.light.groundColor).multiplyScalar(this.light.intensity);
        this.lightSphere.lookAt(a.setFromMatrixPosition(this.light.matrixWorld).negate());
        this.lightSphere.geometry.colorsNeedUpdate = !0
    }
}();
THREE.PointLightHelper = function(a, b) {
    this.light = a;
    this.light.updateMatrixWorld();
    var c = new THREE.SphereGeometry(b, 4, 2),
        d = new THREE.MeshBasicMaterial({
            wireframe: !0,
            fog: !1
        });
    d.color.copy(this.light.color).multiplyScalar(this.light.intensity);
    THREE.Mesh.call(this, c, d);
    this.matrixWorld = this.light.matrixWorld;
    this.matrixAutoUpdate = !1
};
THREE.PointLightHelper.prototype = Object.create(THREE.Mesh.prototype);
THREE.PointLightHelper.prototype.dispose = function() {
    this.geometry.dispose();
    this.material.dispose()
};
THREE.PointLightHelper.prototype.update = function() {
    this.material.color.copy(this.light.color).multiplyScalar(this.light.intensity)
};
THREE.SkeletonHelper = function(a) {
    for (var b = a.skeleton, c = new THREE.Geometry, d = 0; d < b.bones.length; d++) b.bones[d].parent instanceof THREE.Bone && (c.vertices.push(new THREE.Vector3), c.vertices.push(new THREE.Vector3), c.colors.push(new THREE.Color(0, 0, 1)), c.colors.push(new THREE.Color(0, 1, 0)));
    d = new THREE.LineBasicMaterial({
        vertexColors: !0,
        depthTest: !1,
        depthWrite: !1,
        transparent: !0
    });
    THREE.Line.call(this, c, d, THREE.LinePieces);
    this.skeleton = b;
    this.matrixWorld = a.matrixWorld;
    this.matrixAutoUpdate = !1;
    this.update()
};
THREE.SkeletonHelper.prototype = Object.create(THREE.Line.prototype);
THREE.SkeletonHelper.prototype.update = function() {
    for (var a = this.geometry, b = 0, c = 0; c < this.skeleton.bones.length; c++) {
        var d = this.skeleton.bones[c];
        d.parent instanceof THREE.Bone && (a.vertices[b].setFromMatrixPosition(d.skinMatrix), a.vertices[b + 1].setFromMatrixPosition(d.parent.skinMatrix), b += 2)
    }
    a.verticesNeedUpdate = !0;
    a.computeBoundingSphere()
};
THREE.SpotLightHelper = function(a) {
    THREE.Object3D.call(this);
    this.light = a;
    this.light.updateMatrixWorld();
    this.matrixWorld = a.matrixWorld;
    this.matrixAutoUpdate = !1;
    a = new THREE.CylinderGeometry(0, 1, 1, 8, 1, !0);
    a.applyMatrix((new THREE.Matrix4).makeTranslation(0, -0.5, 0));
    a.applyMatrix((new THREE.Matrix4).makeRotationX(-Math.PI / 2));
    var b = new THREE.MeshBasicMaterial({
        wireframe: !0,
        fog: !1
    });
    this.cone = new THREE.Mesh(a, b);
    this.add(this.cone);
    this.update()
};
THREE.SpotLightHelper.prototype = Object.create(THREE.Object3D.prototype);
THREE.SpotLightHelper.prototype.dispose = function() {
    this.cone.geometry.dispose();
    this.cone.material.dispose()
};
THREE.SpotLightHelper.prototype.update = function() {
    var a = new THREE.Vector3,
        b = new THREE.Vector3;
    return function() {
        var c = this.light.distance ? this.light.distance : 1E4,
            d = c * Math.tan(this.light.angle);
        this.cone.scale.set(d, d, c);
        a.setFromMatrixPosition(this.light.matrixWorld);
        b.setFromMatrixPosition(this.light.target.matrixWorld);
        this.cone.lookAt(b.sub(a));
        this.cone.material.color.copy(this.light.color).multiplyScalar(this.light.intensity)
    }
}();
THREE.VertexNormalsHelper = function(a, b, c, d) {
    this.object = a;
    this.size = void 0 !== b ? b : 1;
    b = void 0 !== c ? c : 16711680;
    d = void 0 !== d ? d : 1;
    c = new THREE.Geometry;
    a = a.geometry.faces;
    for (var e = 0, f = a.length; e < f; e++)
        for (var g = 0, h = a[e].vertexNormals.length; g < h; g++) c.vertices.push(new THREE.Vector3, new THREE.Vector3);
    THREE.Line.call(this, c, new THREE.LineBasicMaterial({
        color: b,
        linewidth: d
    }), THREE.LinePieces);
    this.matrixAutoUpdate = !1;
    this.normalMatrix = new THREE.Matrix3;
    this.update()
};
THREE.VertexNormalsHelper.prototype = Object.create(THREE.Line.prototype);
THREE.VertexNormalsHelper.prototype.update = function(a) {
    var b = new THREE.Vector3;
    return function(a) {
        a = ["a", "b", "c", "d"];
        this.object.updateMatrixWorld(!0);
        this.normalMatrix.getNormalMatrix(this.object.matrixWorld);
        for (var d = this.geometry.vertices, e = this.object.geometry.vertices, f = this.object.geometry.faces, g = this.object.matrixWorld, h = 0, k = 0, l = f.length; k < l; k++)
            for (var p = f[k], q = 0, r = p.vertexNormals.length; q < r; q++) {
                var t = p.vertexNormals[q];
                d[h].copy(e[p[a[q]]]).applyMatrix4(g);
                b.copy(t).applyMatrix3(this.normalMatrix).normalize().multiplyScalar(this.size);
                b.add(d[h]);
                h += 1;
                d[h].copy(b);
                h += 1
            }
        this.geometry.verticesNeedUpdate = !0;
        return this
    }
}();
THREE.VertexTangentsHelper = function(a, b, c, d) {
    this.object = a;
    this.size = void 0 !== b ? b : 1;
    b = void 0 !== c ? c : 255;
    d = void 0 !== d ? d : 1;
    c = new THREE.Geometry;
    a = a.geometry.faces;
    for (var e = 0, f = a.length; e < f; e++)
        for (var g = 0, h = a[e].vertexTangents.length; g < h; g++) c.vertices.push(new THREE.Vector3), c.vertices.push(new THREE.Vector3);
    THREE.Line.call(this, c, new THREE.LineBasicMaterial({
        color: b,
        linewidth: d
    }), THREE.LinePieces);
    this.matrixAutoUpdate = !1;
    this.update()
};
THREE.VertexTangentsHelper.prototype = Object.create(THREE.Line.prototype);
THREE.VertexTangentsHelper.prototype.update = function(a) {
    var b = new THREE.Vector3;
    return function(a) {
        a = ["a", "b", "c", "d"];
        this.object.updateMatrixWorld(!0);
        for (var d = this.geometry.vertices, e = this.object.geometry.vertices, f = this.object.geometry.faces, g = this.object.matrixWorld, h = 0, k = 0, l = f.length; k < l; k++)
            for (var p = f[k], q = 0, r = p.vertexTangents.length; q < r; q++) {
                var t = p.vertexTangents[q];
                d[h].copy(e[p[a[q]]]).applyMatrix4(g);
                b.copy(t).transformDirection(g).multiplyScalar(this.size);
                b.add(d[h]);
                h += 1;
                d[h].copy(b);
                h += 1
            }
        this.geometry.verticesNeedUpdate = !0;
        return this
    }
}();
THREE.WireframeHelper = function(a, b) {
    var c = void 0 !== b ? b : 16777215,
        d = [0, 0],
        e = {},
        f = function(a, b) {
            return a - b
        },
        g = ["a", "b", "c"],
        h = new THREE.BufferGeometry;
    if (a.geometry instanceof THREE.Geometry) {
        for (var k = a.geometry.vertices, l = a.geometry.faces, p = 0, q = new Uint32Array(6 * l.length), r = 0, t = l.length; r < t; r++)
            for (var s = l[r], n = 0; 3 > n; n++) {
                d[0] = s[g[n]];
                d[1] = s[g[(n + 1) % 3]];
                d.sort(f);
                var v = d.toString();
                void 0 === e[v] && (q[2 * p] = d[0], q[2 * p + 1] = d[1], e[v] = !0, p++)
            }
        d = new Float32Array(6 * p);
        r = 0;
        for (t = p; r < t; r++)
            for (n = 0; 2 > n; n++) p =
                k[q[2 * r + n]], g = 6 * r + 3 * n, d[g + 0] = p.x, d[g + 1] = p.y, d[g + 2] = p.z;
        h.addAttribute("position", new THREE.BufferAttribute(d, 3))
    } else if (a.geometry instanceof THREE.BufferGeometry && void 0 !== a.geometry.attributes.index) {
        for (var k = a.geometry.attributes.position.array, t = a.geometry.attributes.index.array, l = a.geometry.offsets, p = 0, q = new Uint32Array(2 * t.length), s = 0, w = l.length; s < w; ++s)
            for (var n = l[s].start, v = l[s].count, g = l[s].index, r = n, u = n + v; r < u; r += 3)
                for (n = 0; 3 > n; n++) d[0] = g + t[r + n], d[1] = g + t[r + (n + 1) % 3], d.sort(f), v = d.toString(),
                    void 0 === e[v] && (q[2 * p] = d[0], q[2 * p + 1] = d[1], e[v] = !0, p++);
        d = new Float32Array(6 * p);
        r = 0;
        for (t = p; r < t; r++)
            for (n = 0; 2 > n; n++) g = 6 * r + 3 * n, p = 3 * q[2 * r + n], d[g + 0] = k[p], d[g + 1] = k[p + 1], d[g + 2] = k[p + 2];
        h.addAttribute("position", new THREE.BufferAttribute(d, 3))
    } else if (a.geometry instanceof THREE.BufferGeometry) {
        k = a.geometry.attributes.position.array;
        p = k.length / 3;
        q = p / 3;
        d = new Float32Array(6 * p);
        r = 0;
        for (t = q; r < t; r++)
            for (n = 0; 3 > n; n++) g = 18 * r + 6 * n, q = 9 * r + 3 * n, d[g + 0] = k[q], d[g + 1] = k[q + 1], d[g + 2] = k[q + 2], p = 9 * r + (n + 1) % 3 * 3, d[g + 3] = k[p], d[g + 4] =
                k[p + 1], d[g + 5] = k[p + 2];
        h.addAttribute("position", new THREE.BufferAttribute(d, 3))
    }
    THREE.Line.call(this, h, new THREE.LineBasicMaterial({
        color: c
    }), THREE.LinePieces);
    this.matrixAutoUpdate = !1;
    this.matrixWorld = a.matrixWorld
};
THREE.WireframeHelper.prototype = Object.create(THREE.Line.prototype);
THREE.ImmediateRenderObject = function() {
    THREE.Object3D.call(this);
    this.render = function(a) {}
};
THREE.ImmediateRenderObject.prototype = Object.create(THREE.Object3D.prototype);
THREE.LensFlare = function(a, b, c, d, e) {
    THREE.Object3D.call(this);
    this.lensFlares = [];
    this.positionScreen = new THREE.Vector3;
    this.customUpdateCallback = void 0;
    void 0 !== a && this.add(a, b, c, d, e)
};
THREE.LensFlare.prototype = Object.create(THREE.Object3D.prototype);
THREE.LensFlare.prototype.add = function(a, b, c, d, e, f) {
    void 0 === b && (b = -1);
    void 0 === c && (c = 0);
    void 0 === f && (f = 1);
    void 0 === e && (e = new THREE.Color(16777215));
    void 0 === d && (d = THREE.NormalBlending);
    c = Math.min(c, Math.max(0, c));
    this.lensFlares.push({
        texture: a,
        size: b,
        distance: c,
        x: 0,
        y: 0,
        z: 0,
        scale: 1,
        rotation: 1,
        opacity: f,
        color: e,
        blending: d
    })
};
THREE.LensFlare.prototype.updateLensFlares = function() {
    var a, b = this.lensFlares.length,
        c, d = 2 * -this.positionScreen.x,
        e = 2 * -this.positionScreen.y;
    for (a = 0; a < b; a++) c = this.lensFlares[a], c.x = this.positionScreen.x + d * c.distance, c.y = this.positionScreen.y + e * c.distance, c.wantedRotation = c.x * Math.PI * 0.25, c.rotation += 0.25 * (c.wantedRotation - c.rotation)
};
THREE.MorphBlendMesh = function(a, b) {
    THREE.Mesh.call(this, a, b);
    this.animationsMap = {};
    this.animationsList = [];
    var c = this.geometry.morphTargets.length;
    this.createAnimation("__default", 0, c - 1, c / 1);
    this.setAnimationWeight("__default", 1)
};
THREE.MorphBlendMesh.prototype = Object.create(THREE.Mesh.prototype);
THREE.MorphBlendMesh.prototype.createAnimation = function(a, b, c, d) {
    b = {
        startFrame: b,
        endFrame: c,
        length: c - b + 1,
        fps: d,
        duration: (c - b) / d,
        lastFrame: 0,
        currentFrame: 0,
        active: !1,
        time: 0,
        direction: 1,
        weight: 1,
        directionBackwards: !1,
        mirroredLoop: !1
    };
    this.animationsMap[a] = b;
    this.animationsList.push(b)
};
THREE.MorphBlendMesh.prototype.autoCreateAnimations = function(a) {
    for (var b = /([a-z]+)_?(\d+)/, c, d = {}, e = this.geometry, f = 0, g = e.morphTargets.length; f < g; f++) {
        var h = e.morphTargets[f].name.match(b);
        if (h && 1 < h.length) {
            var k = h[1];
            d[k] || (d[k] = {
                start: Infinity,
                end: -Infinity
            });
            h = d[k];
            f < h.start && (h.start = f);
            f > h.end && (h.end = f);
            c || (c = k)
        }
    }
    for (k in d) h = d[k], this.createAnimation(k, h.start, h.end, a);
    this.firstAnimation = c
};
THREE.MorphBlendMesh.prototype.setAnimationDirectionForward = function(a) {
    if (a = this.animationsMap[a]) a.direction = 1, a.directionBackwards = !1
};
THREE.MorphBlendMesh.prototype.setAnimationDirectionBackward = function(a) {
    if (a = this.animationsMap[a]) a.direction = -1, a.directionBackwards = !0
};
THREE.MorphBlendMesh.prototype.setAnimationFPS = function(a, b) {
    var c = this.animationsMap[a];
    c && (c.fps = b, c.duration = (c.end - c.start) / c.fps)
};
THREE.MorphBlendMesh.prototype.setAnimationDuration = function(a, b) {
    var c = this.animationsMap[a];
    c && (c.duration = b, c.fps = (c.end - c.start) / c.duration)
};
THREE.MorphBlendMesh.prototype.setAnimationWeight = function(a, b) {
    var c = this.animationsMap[a];
    c && (c.weight = b)
};
THREE.MorphBlendMesh.prototype.setAnimationTime = function(a, b) {
    var c = this.animationsMap[a];
    c && (c.time = b)
};
THREE.MorphBlendMesh.prototype.getAnimationTime = function(a) {
    var b = 0;
    if (a = this.animationsMap[a]) b = a.time;
    return b
};
THREE.MorphBlendMesh.prototype.getAnimationDuration = function(a) {
    var b = -1;
    if (a = this.animationsMap[a]) b = a.duration;
    return b
};
THREE.MorphBlendMesh.prototype.playAnimation = function(a) {
    var b = this.animationsMap[a];
    b ? (b.time = 0, b.active = !0) : console.warn("animation[" + a + "] undefined")
};
THREE.MorphBlendMesh.prototype.stopAnimation = function(a) {
    if (a = this.animationsMap[a]) a.active = !1
};
THREE.MorphBlendMesh.prototype.update = function(a) {
    for (var b = 0, c = this.animationsList.length; b < c; b++) {
        var d = this.animationsList[b];
        if (d.active) {
            var e = d.duration / d.length;
            d.time += d.direction * a;
            if (d.mirroredLoop) {
                if (d.time > d.duration || 0 > d.time) d.direction *= -1, d.time > d.duration && (d.time = d.duration, d.directionBackwards = !0), 0 > d.time && (d.time = 0, d.directionBackwards = !1)
            } else d.time %= d.duration, 0 > d.time && (d.time += d.duration);
            var f = d.startFrame + THREE.Math.clamp(Math.floor(d.time / e), 0, d.length - 1),
                g = d.weight;
            f !== d.currentFrame && (this.morphTargetInfluences[d.lastFrame] = 0, this.morphTargetInfluences[d.currentFrame] = 1 * g, this.morphTargetInfluences[f] = 0, d.lastFrame = d.currentFrame, d.currentFrame = f);
            e = d.time % e / e;
            d.directionBackwards && (e = 1 - e);
            this.morphTargetInfluences[d.currentFrame] = e * g;
            this.morphTargetInfluences[d.lastFrame] = (1 - e) * g
        }
    }
};
THREE.LensFlarePlugin = function() {
    function a(a, c) {
        var d = b.createProgram(),
            e = b.createShader(b.FRAGMENT_SHADER),
            f = b.createShader(b.VERTEX_SHADER),
            g = "precision " + c + " float;\n";
        b.shaderSource(e, g + a.fragmentShader);
        b.shaderSource(f, g + a.vertexShader);
        b.compileShader(e);
        b.compileShader(f);
        b.attachShader(d, e);
        b.attachShader(d, f);
        b.linkProgram(d);
        return d
    }
    var b, c, d, e, f, g, h, k, l, p, q, r, t;
    this.init = function(s) {
        b = s.context;
        c = s;
        d = s.getPrecision();
        e = new Float32Array(16);
        f = new Uint16Array(6);
        s = 0;
        e[s++] = -1;
        e[s++] = -1;
        e[s++] = 0;
        e[s++] = 0;
        e[s++] = 1;
        e[s++] = -1;
        e[s++] = 1;
        e[s++] = 0;
        e[s++] = 1;
        e[s++] = 1;
        e[s++] = 1;
        e[s++] = 1;
        e[s++] = -1;
        e[s++] = 1;
        e[s++] = 0;
        e[s++] = 1;
        s = 0;
        f[s++] = 0;
        f[s++] = 1;
        f[s++] = 2;
        f[s++] = 0;
        f[s++] = 2;
        f[s++] = 3;
        g = b.createBuffer();
        h = b.createBuffer();
        b.bindBuffer(b.ARRAY_BUFFER, g);
        b.bufferData(b.ARRAY_BUFFER, e, b.STATIC_DRAW);
        b.bindBuffer(b.ELEMENT_ARRAY_BUFFER, h);
        b.bufferData(b.ELEMENT_ARRAY_BUFFER, f, b.STATIC_DRAW);
        k = b.createTexture();
        l = b.createTexture();
        b.bindTexture(b.TEXTURE_2D, k);
        b.texImage2D(b.TEXTURE_2D, 0, b.RGB, 16, 16,
            0, b.RGB, b.UNSIGNED_BYTE, null);
        b.texParameteri(b.TEXTURE_2D, b.TEXTURE_WRAP_S, b.CLAMP_TO_EDGE);
        b.texParameteri(b.TEXTURE_2D, b.TEXTURE_WRAP_T, b.CLAMP_TO_EDGE);
        b.texParameteri(b.TEXTURE_2D, b.TEXTURE_MAG_FILTER, b.NEAREST);
        b.texParameteri(b.TEXTURE_2D, b.TEXTURE_MIN_FILTER, b.NEAREST);
        b.bindTexture(b.TEXTURE_2D, l);
        b.texImage2D(b.TEXTURE_2D, 0, b.RGBA, 16, 16, 0, b.RGBA, b.UNSIGNED_BYTE, null);
        b.texParameteri(b.TEXTURE_2D, b.TEXTURE_WRAP_S, b.CLAMP_TO_EDGE);
        b.texParameteri(b.TEXTURE_2D, b.TEXTURE_WRAP_T, b.CLAMP_TO_EDGE);
        b.texParameteri(b.TEXTURE_2D, b.TEXTURE_MAG_FILTER, b.NEAREST);
        b.texParameteri(b.TEXTURE_2D, b.TEXTURE_MIN_FILTER, b.NEAREST);
        0 >= b.getParameter(b.MAX_VERTEX_TEXTURE_IMAGE_UNITS) ? (p = !1, q = a(THREE.ShaderFlares.lensFlare, d)) : (p = !0, q = a(THREE.ShaderFlares.lensFlareVertexTexture, d));
        r = {};
        t = {};
        r.vertex = b.getAttribLocation(q, "position");
        r.uv = b.getAttribLocation(q, "uv");
        t.renderType = b.getUniformLocation(q, "renderType");
        t.map = b.getUniformLocation(q, "map");
        t.occlusionMap = b.getUniformLocation(q, "occlusionMap");
        t.opacity =
            b.getUniformLocation(q, "opacity");
        t.color = b.getUniformLocation(q, "color");
        t.scale = b.getUniformLocation(q, "scale");
        t.rotation = b.getUniformLocation(q, "rotation");
        t.screenPosition = b.getUniformLocation(q, "screenPosition")
    };
    this.render = function(a, d, e, f) {
        a = a.__webglFlares;
        var u = a.length;
        if (u) {
            var x = new THREE.Vector3,
                K = f / e,
                A = 0.5 * e,
                G = 0.5 * f,
                B = 16 / f,
                C = new THREE.Vector2(B * K, B),
                E = new THREE.Vector3(1, 1, 0),
                H = new THREE.Vector2(1, 1),
                y = t,
                B = r;
            b.useProgram(q);
            b.enableVertexAttribArray(r.vertex);
            b.enableVertexAttribArray(r.uv);
            b.uniform1i(y.occlusionMap, 0);
            b.uniform1i(y.map, 1);
            b.bindBuffer(b.ARRAY_BUFFER, g);
            b.vertexAttribPointer(B.vertex, 2, b.FLOAT, !1, 16, 0);
            b.vertexAttribPointer(B.uv, 2, b.FLOAT, !1, 16, 8);
            b.bindBuffer(b.ELEMENT_ARRAY_BUFFER, h);
            b.disable(b.CULL_FACE);
            b.depthMask(!1);
            var Q, z, R, L, I;
            for (Q = 0; Q < u; Q++)
                if (B = 16 / f, C.set(B * K, B), L = a[Q], !1 !== L.visible && (x.set(L.matrixWorld.elements[12], L.matrixWorld.elements[13], L.matrixWorld.elements[14]), x.applyMatrix4(d.matrixWorldInverse), x.applyProjection(d.projectionMatrix), E.copy(x),
                        H.x = E.x * A + A, H.y = E.y * G + G, p || 0 < H.x && H.x < e && 0 < H.y && H.y < f))
                    for (b.activeTexture(b.TEXTURE1), b.bindTexture(b.TEXTURE_2D, k), b.copyTexImage2D(b.TEXTURE_2D, 0, b.RGB, H.x - 8, H.y - 8, 16, 16, 0), b.uniform1i(y.renderType, 0), b.uniform2f(y.scale, C.x, C.y), b.uniform3f(y.screenPosition, E.x, E.y, E.z), b.disable(b.BLEND), b.enable(b.DEPTH_TEST), b.drawElements(b.TRIANGLES, 6, b.UNSIGNED_SHORT, 0), b.activeTexture(b.TEXTURE0), b.bindTexture(b.TEXTURE_2D, l), b.copyTexImage2D(b.TEXTURE_2D, 0, b.RGBA, H.x - 8, H.y - 8, 16, 16, 0), b.uniform1i(y.renderType,
                            1), b.disable(b.DEPTH_TEST), b.activeTexture(b.TEXTURE1), b.bindTexture(b.TEXTURE_2D, k), b.drawElements(b.TRIANGLES, 6, b.UNSIGNED_SHORT, 0), L.positionScreen.copy(E), L.customUpdateCallback ? L.customUpdateCallback(L) : L.updateLensFlares(), b.uniform1i(y.renderType, 2), b.enable(b.BLEND), z = 0, R = L.lensFlares.length; z < R; z++) I = L.lensFlares[z], 0.001 < I.opacity && 0.001 < I.scale && (E.x = I.x, E.y = I.y, E.z = I.z, B = I.size * I.scale / f, C.x = B * K, C.y = B, b.uniform3f(y.screenPosition, E.x, E.y, E.z), b.uniform2f(y.scale, C.x, C.y), b.uniform1f(y.rotation,
                        I.rotation), b.uniform1f(y.opacity, I.opacity), b.uniform3f(y.color, I.color.r, I.color.g, I.color.b), c.setBlending(I.blending, I.blendEquation, I.blendSrc, I.blendDst), c.setTexture(I.texture, 1), b.drawElements(b.TRIANGLES, 6, b.UNSIGNED_SHORT, 0));
            b.enable(b.CULL_FACE);
            b.enable(b.DEPTH_TEST);
            b.depthMask(!0)
        }
    }
};
THREE.ShadowMapPlugin = function() {
    var a, b, c, d, e, f, g = new THREE.Frustum,
        h = new THREE.Matrix4,
        k = new THREE.Vector3,
        l = new THREE.Vector3,
        p = new THREE.Vector3;
    this.init = function(g) {
        a = g.context;
        b = g;
        g = THREE.ShaderLib.depthRGBA;
        var h = THREE.UniformsUtils.clone(g.uniforms);
        c = new THREE.ShaderMaterial({
            fragmentShader: g.fragmentShader,
            vertexShader: g.vertexShader,
            uniforms: h
        });
        d = new THREE.ShaderMaterial({
            fragmentShader: g.fragmentShader,
            vertexShader: g.vertexShader,
            uniforms: h,
            morphTargets: !0
        });
        e = new THREE.ShaderMaterial({
            fragmentShader: g.fragmentShader,
            vertexShader: g.vertexShader,
            uniforms: h,
            skinning: !0
        });
        f = new THREE.ShaderMaterial({
            fragmentShader: g.fragmentShader,
            vertexShader: g.vertexShader,
            uniforms: h,
            morphTargets: !0,
            skinning: !0
        });
        c._shadowPass = !0;
        d._shadowPass = !0;
        e._shadowPass = !0;
        f._shadowPass = !0
    };
    this.render = function(a, c) {
        b.shadowMapEnabled && b.shadowMapAutoUpdate && this.update(a, c)
    };
    this.update = function(q, r) {
        var t, s, n, v, w, u, x, K, A, G = [];
        v = 0;
        a.clearColor(1, 1, 1, 1);
        a.disable(a.BLEND);
        a.enable(a.CULL_FACE);
        a.frontFace(a.CCW);
        b.shadowMapCullFace === THREE.CullFaceFront ?
            a.cullFace(a.FRONT) : a.cullFace(a.BACK);
        b.setDepthTest(!0);
        t = 0;
        for (s = q.__lights.length; t < s; t++)
            if (n = q.__lights[t], n.castShadow)
                if (n instanceof THREE.DirectionalLight && n.shadowCascade)
                    for (w = 0; w < n.shadowCascadeCount; w++) {
                        var B;
                        if (n.shadowCascadeArray[w]) B = n.shadowCascadeArray[w];
                        else {
                            A = n;
                            x = w;
                            B = new THREE.DirectionalLight;
                            B.isVirtual = !0;
                            B.onlyShadow = !0;
                            B.castShadow = !0;
                            B.shadowCameraNear = A.shadowCameraNear;
                            B.shadowCameraFar = A.shadowCameraFar;
                            B.shadowCameraLeft = A.shadowCameraLeft;
                            B.shadowCameraRight = A.shadowCameraRight;
                            B.shadowCameraBottom = A.shadowCameraBottom;
                            B.shadowCameraTop = A.shadowCameraTop;
                            B.shadowCameraVisible = A.shadowCameraVisible;
                            B.shadowDarkness = A.shadowDarkness;
                            B.shadowBias = A.shadowCascadeBias[x];
                            B.shadowMapWidth = A.shadowCascadeWidth[x];
                            B.shadowMapHeight = A.shadowCascadeHeight[x];
                            B.pointsWorld = [];
                            B.pointsFrustum = [];
                            var C = B.pointsWorld;
                            u = B.pointsFrustum;
                            for (K = 0; 8 > K; K++) C[K] = new THREE.Vector3, u[K] = new THREE.Vector3;
                            C = A.shadowCascadeNearZ[x];
                            A = A.shadowCascadeFarZ[x];
                            u[0].set(-1, -1, C);
                            u[1].set(1, -1, C);
                            u[2].set(-1,
                                1, C);
                            u[3].set(1, 1, C);
                            u[4].set(-1, -1, A);
                            u[5].set(1, -1, A);
                            u[6].set(-1, 1, A);
                            u[7].set(1, 1, A);
                            B.originalCamera = r;
                            u = new THREE.Gyroscope;
                            u.position.copy(n.shadowCascadeOffset);
                            u.add(B);
                            u.add(B.target);
                            r.add(u);
                            n.shadowCascadeArray[w] = B;
                            console.log("Created virtualLight", B)
                        }
                        x = n;
                        C = w;
                        A = x.shadowCascadeArray[C];
                        A.position.copy(x.position);
                        A.target.position.copy(x.target.position);
                        A.lookAt(A.target);
                        A.shadowCameraVisible = x.shadowCameraVisible;
                        A.shadowDarkness = x.shadowDarkness;
                        A.shadowBias = x.shadowCascadeBias[C];
                        u = x.shadowCascadeNearZ[C];
                        x = x.shadowCascadeFarZ[C];
                        A = A.pointsFrustum;
                        A[0].z = u;
                        A[1].z = u;
                        A[2].z = u;
                        A[3].z = u;
                        A[4].z = x;
                        A[5].z = x;
                        A[6].z = x;
                        A[7].z = x;
                        G[v] = B;
                        v++
                    } else G[v] = n, v++;
        t = 0;
        for (s = G.length; t < s; t++) {
            n = G[t];
            n.shadowMap || (w = THREE.LinearFilter, b.shadowMapType === THREE.PCFSoftShadowMap && (w = THREE.NearestFilter), n.shadowMap = new THREE.WebGLRenderTarget(n.shadowMapWidth, n.shadowMapHeight, {
                    minFilter: w,
                    magFilter: w,
                    format: THREE.RGBAFormat
                }), n.shadowMapSize = new THREE.Vector2(n.shadowMapWidth, n.shadowMapHeight), n.shadowMatrix =
                new THREE.Matrix4);
            if (!n.shadowCamera) {
                if (n instanceof THREE.SpotLight) n.shadowCamera = new THREE.PerspectiveCamera(n.shadowCameraFov, n.shadowMapWidth / n.shadowMapHeight, n.shadowCameraNear, n.shadowCameraFar);
                else if (n instanceof THREE.DirectionalLight) n.shadowCamera = new THREE.OrthographicCamera(n.shadowCameraLeft, n.shadowCameraRight, n.shadowCameraTop, n.shadowCameraBottom, n.shadowCameraNear, n.shadowCameraFar);
                else {
                    console.error("Unsupported light type for shadow");
                    continue
                }
                q.add(n.shadowCamera);
                !0 ===
                    q.autoUpdate && q.updateMatrixWorld()
            }
            n.shadowCameraVisible && !n.cameraHelper && (n.cameraHelper = new THREE.CameraHelper(n.shadowCamera), n.shadowCamera.add(n.cameraHelper));
            if (n.isVirtual && B.originalCamera == r) {
                w = r;
                v = n.shadowCamera;
                u = n.pointsFrustum;
                A = n.pointsWorld;
                k.set(Infinity, Infinity, Infinity);
                l.set(-Infinity, -Infinity, -Infinity);
                for (x = 0; 8 > x; x++) C = A[x], C.copy(u[x]), THREE.ShadowMapPlugin.__projector.unprojectVector(C, w), C.applyMatrix4(v.matrixWorldInverse), C.x < k.x && (k.x = C.x), C.x > l.x && (l.x = C.x), C.y < k.y &&
                    (k.y = C.y), C.y > l.y && (l.y = C.y), C.z < k.z && (k.z = C.z), C.z > l.z && (l.z = C.z);
                v.left = k.x;
                v.right = l.x;
                v.top = l.y;
                v.bottom = k.y;
                v.updateProjectionMatrix()
            }
            v = n.shadowMap;
            u = n.shadowMatrix;
            w = n.shadowCamera;
            w.position.setFromMatrixPosition(n.matrixWorld);
            p.setFromMatrixPosition(n.target.matrixWorld);
            w.lookAt(p);
            w.updateMatrixWorld();
            w.matrixWorldInverse.getInverse(w.matrixWorld);
            n.cameraHelper && (n.cameraHelper.visible = n.shadowCameraVisible);
            n.shadowCameraVisible && n.cameraHelper.update();
            u.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5,
                0, 0, 0.5, 0.5, 0, 0, 0, 1);
            u.multiply(w.projectionMatrix);
            u.multiply(w.matrixWorldInverse);
            h.multiplyMatrices(w.projectionMatrix, w.matrixWorldInverse);
            g.setFromMatrix(h);
            b.setRenderTarget(v);
            b.clear();
            A = q.__webglObjects;
            n = 0;
            for (v = A.length; n < v; n++) x = A[n], u = x.object, x.render = !1, u.visible && u.castShadow && (!1 === u.frustumCulled || !0 === g.intersectsObject(u)) && (u._modelViewMatrix.multiplyMatrices(w.matrixWorldInverse, u.matrixWorld), x.render = !0);
            var E;
            n = 0;
            for (v = A.length; n < v; n++) x = A[n], x.render && (u = x.object, x = x.buffer,
                C = u.material instanceof THREE.MeshFaceMaterial ? u.material.materials[0] : u.material, K = void 0 !== u.geometry.morphTargets && 0 < u.geometry.morphTargets.length && C.morphTargets, E = u instanceof THREE.SkinnedMesh && C.skinning, K = u.customDepthMaterial ? u.customDepthMaterial : E ? K ? f : e : K ? d : c, b.setMaterialFaces(C), x instanceof THREE.BufferGeometry ? b.renderBufferDirect(w, q.__lights, null, K, x, u) : b.renderBuffer(w, q.__lights, null, K, x, u));
            A = q.__webglObjectsImmediate;
            n = 0;
            for (v = A.length; n < v; n++) x = A[n], u = x.object, u.visible && u.castShadow &&
                (u._modelViewMatrix.multiplyMatrices(w.matrixWorldInverse, u.matrixWorld), b.renderImmediateObject(w, q.__lights, null, c, u))
        }
        t = b.getClearColor();
        s = b.getClearAlpha();
        a.clearColor(t.r, t.g, t.b, s);
        a.enable(a.BLEND);
        b.shadowMapCullFace === THREE.CullFaceFront && a.cullFace(a.BACK)
    }
};
THREE.ShadowMapPlugin.__projector = new THREE.Projector;
THREE.SpritePlugin = function() {
    var a, b, c, d, e, f, g, h, k, l, p, q, r, t, s, n, v;

    function w(a, b) {
        return a.z !== b.z ? b.z - a.z : b.id - a.id
    }
    var u, x, K, A, G, B, C, E;
    this.init = function(w) {
        u = w.context;
        x = w;
        A = new Float32Array([-0.5, -0.5, 0, 0, 0.5, -0.5, 1, 0, 0.5, 0.5, 1, 1, -0.5, 0.5, 0, 1]);
        G = new Uint16Array([0, 1, 2, 0, 2, 3]);
        B = u.createBuffer();
        C = u.createBuffer();
        u.bindBuffer(u.ARRAY_BUFFER, B);
        u.bufferData(u.ARRAY_BUFFER, A, u.STATIC_DRAW);
        u.bindBuffer(u.ELEMENT_ARRAY_BUFFER, C);
        u.bufferData(u.ELEMENT_ARRAY_BUFFER, G, u.STATIC_DRAW);
        w = u.createProgram();
        var y = u.createShader(u.VERTEX_SHADER),
            Q = u.createShader(u.FRAGMENT_SHADER);
        u.shaderSource(y, ["precision " + x.getPrecision() + " float;", "uniform mat4 modelViewMatrix;\nuniform mat4 projectionMatrix;\nuniform float rotation;\nuniform vec2 scale;\nuniform vec2 uvOffset;\nuniform vec2 uvScale;\nattribute vec2 position;\nattribute vec2 uv;\nvarying vec2 vUV;\nvoid main() {\nvUV = uvOffset + uv * uvScale;\nvec2 alignedPosition = position * scale;\nvec2 rotatedPosition;\nrotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;\nrotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;\nvec4 finalPosition;\nfinalPosition = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );\nfinalPosition.xy += rotatedPosition;\nfinalPosition = projectionMatrix * finalPosition;\ngl_Position = finalPosition;\n}"].join("\n"));
        u.shaderSource(Q, ["precision " + x.getPrecision() + " float;", "uniform vec3 color;\nuniform sampler2D map;\nuniform float opacity;\nuniform int fogType;\nuniform vec3 fogColor;\nuniform float fogDensity;\nuniform float fogNear;\nuniform float fogFar;\nuniform float alphaTest;\nvarying vec2 vUV;\nvoid main() {\nvec4 texture = texture2D( map, vUV );\nif ( texture.a < alphaTest ) discard;\ngl_FragColor = vec4( color * texture.xyz, texture.a * opacity );\nif ( fogType > 0 ) {\nfloat depth = gl_FragCoord.z / gl_FragCoord.w;\nfloat fogFactor = 0.0;\nif ( fogType == 1 ) {\nfogFactor = smoothstep( fogNear, fogFar, depth );\n} else {\nconst float LOG2 = 1.442695;\nfloat fogFactor = exp2( - fogDensity * fogDensity * depth * depth * LOG2 );\nfogFactor = 1.0 - clamp( fogFactor, 0.0, 1.0 );\n}\ngl_FragColor = mix( gl_FragColor, vec4( fogColor, gl_FragColor.w ), fogFactor );\n}\n}"].join("\n"));
        u.compileShader(y);
        u.compileShader(Q);
        u.attachShader(w, y);
        u.attachShader(w, Q);
        u.linkProgram(w);
        E = w;
        n = u.getAttribLocation(E, "position");
        v = u.getAttribLocation(E, "uv");
        a = u.getUniformLocation(E, "uvOffset");
        b = u.getUniformLocation(E, "uvScale");
        c = u.getUniformLocation(E, "rotation");
        d = u.getUniformLocation(E, "scale");
        e = u.getUniformLocation(E, "color");
        f = u.getUniformLocation(E, "map");
        g = u.getUniformLocation(E, "opacity");
        h = u.getUniformLocation(E, "modelViewMatrix");
        k = u.getUniformLocation(E, "projectionMatrix");
        l =
            u.getUniformLocation(E, "fogType");
        p = u.getUniformLocation(E, "fogDensity");
        q = u.getUniformLocation(E, "fogNear");
        r = u.getUniformLocation(E, "fogFar");
        t = u.getUniformLocation(E, "fogColor");
        s = u.getUniformLocation(E, "alphaTest");
        w = document.createElement("canvas");
        w.width = 8;
        w.height = 8;
        y = w.getContext("2d");
        y.fillStyle = "white";
        y.fillRect(0, 0, 8, 8);
        K = new THREE.Texture(w);
        K.needsUpdate = !0
    };
    this.render = function(A, y, G, z) {
        G = A.__webglSprites;
        if (z = G.length) {
            u.useProgram(E);
            u.enableVertexAttribArray(n);
            u.enableVertexAttribArray(v);
            u.disable(u.CULL_FACE);
            u.enable(u.BLEND);
            u.bindBuffer(u.ARRAY_BUFFER, B);
            u.vertexAttribPointer(n, 2, u.FLOAT, !1, 16, 0);
            u.vertexAttribPointer(v, 2, u.FLOAT, !1, 16, 8);
            u.bindBuffer(u.ELEMENT_ARRAY_BUFFER, C);
            u.uniformMatrix4fv(k, !1, y.projectionMatrix.elements);
            u.activeTexture(u.TEXTURE0);
            u.uniform1i(f, 0);
            var R = 0,
                L = 0,
                I = A.fog;
            I ? (u.uniform3f(t, I.color.r, I.color.g, I.color.b), I instanceof THREE.Fog ? (u.uniform1f(q, I.near), u.uniform1f(r, I.far), u.uniform1i(l, 1), L = R = 1) : I instanceof THREE.FogExp2 && (u.uniform1f(p, I.density),
                u.uniform1i(l, 2), L = R = 2)) : (u.uniform1i(l, 0), L = R = 0);
            for (var F, P = [], I = 0; I < z; I++) F = G[I], !1 !== F.visible && (F._modelViewMatrix.multiplyMatrices(y.matrixWorldInverse, F.matrixWorld), F.z = -F._modelViewMatrix.elements[14]);
            G.sort(w);
            for (I = 0; I < z; I++) F = G[I], !1 !== F.visible && (y = F.material, u.uniform1f(s, y.alphaTest), u.uniformMatrix4fv(h, !1, F._modelViewMatrix.elements), P[0] = F.scale.x, P[1] = F.scale.y, F = A.fog && y.fog ? L : 0, R !== F && (u.uniform1i(l, F), R = F), null !== y.map ? (u.uniform2f(a, y.map.offset.x, y.map.offset.y), u.uniform2f(b,
                y.map.repeat.x, y.map.repeat.y)) : (u.uniform2f(a, 0, 0), u.uniform2f(b, 1, 1)), u.uniform1f(g, y.opacity), u.uniform3f(e, y.color.r, y.color.g, y.color.b), u.uniform1f(c, y.rotation), u.uniform2fv(d, P), x.setBlending(y.blending, y.blendEquation, y.blendSrc, y.blendDst), x.setDepthTest(y.depthTest), x.setDepthWrite(y.depthWrite), y.map && y.map.image && y.map.image.width ? x.setTexture(y.map, 0) : x.setTexture(K, 0), u.drawElements(u.TRIANGLES, 6, u.UNSIGNED_SHORT, 0));
            u.enable(u.CULL_FACE)
        }
    }
};
THREE.DepthPassPlugin = function() {
    this.enabled = !1;
    this.renderTarget = null;
    var a, b, c, d, e, f, g = new THREE.Frustum,
        h = new THREE.Matrix4;
    this.init = function(g) {
        a = g.context;
        b = g;
        g = THREE.ShaderLib.depthRGBA;
        var h = THREE.UniformsUtils.clone(g.uniforms);
        c = new THREE.ShaderMaterial({
            fragmentShader: g.fragmentShader,
            vertexShader: g.vertexShader,
            uniforms: h
        });
        d = new THREE.ShaderMaterial({
            fragmentShader: g.fragmentShader,
            vertexShader: g.vertexShader,
            uniforms: h,
            morphTargets: !0
        });
        e = new THREE.ShaderMaterial({
            fragmentShader: g.fragmentShader,
            vertexShader: g.vertexShader,
            uniforms: h,
            skinning: !0
        });
        f = new THREE.ShaderMaterial({
            fragmentShader: g.fragmentShader,
            vertexShader: g.vertexShader,
            uniforms: h,
            morphTargets: !0,
            skinning: !0
        });
        c._shadowPass = !0;
        d._shadowPass = !0;
        e._shadowPass = !0;
        f._shadowPass = !0
    };
    this.render = function(a, b) {
        this.enabled && this.update(a, b)
    };
    this.update = function(k, l) {
        var p, q, r, t, s, n;
        a.clearColor(1, 1, 1, 1);
        a.disable(a.BLEND);
        b.setDepthTest(!0);
        !0 === k.autoUpdate && k.updateMatrixWorld();
        l.matrixWorldInverse.getInverse(l.matrixWorld);
        h.multiplyMatrices(l.projectionMatrix,
            l.matrixWorldInverse);
        g.setFromMatrix(h);
        b.setRenderTarget(this.renderTarget);
        b.clear();
        n = k.__webglObjects;
        p = 0;
        for (q = n.length; p < q; p++) r = n[p], s = r.object, r.render = !1, !s.visible || !1 !== s.frustumCulled && !0 !== g.intersectsObject(s) || (s._modelViewMatrix.multiplyMatrices(l.matrixWorldInverse, s.matrixWorld), r.render = !0);
        var v;
        p = 0;
        for (q = n.length; p < q; p++) r = n[p], r.render && (s = r.object, r = r.buffer, s instanceof THREE.PointCloud && !s.customDepthMaterial || ((v = s.material instanceof THREE.MeshFaceMaterial ? s.material.materials[0] :
            s.material) && b.setMaterialFaces(s.material), t = void 0 !== s.geometry.morphTargets && 0 < s.geometry.morphTargets.length && v.morphTargets, v = s instanceof THREE.SkinnedMesh && v.skinning, t = s.customDepthMaterial ? s.customDepthMaterial : v ? t ? f : e : t ? d : c, r instanceof THREE.BufferGeometry ? b.renderBufferDirect(l, k.__lights, null, t, r, s) : b.renderBuffer(l, k.__lights, null, t, r, s)));
        n = k.__webglObjectsImmediate;
        p = 0;
        for (q = n.length; p < q; p++) r = n[p], s = r.object, s.visible && (s._modelViewMatrix.multiplyMatrices(l.matrixWorldInverse, s.matrixWorld),
            b.renderImmediateObject(l, k.__lights, null, c, s));
        p = b.getClearColor();
        q = b.getClearAlpha();
        a.clearColor(p.r, p.g, p.b, q);
        a.enable(a.BLEND)
    }
};
THREE.ShaderFlares = {
    lensFlareVertexTexture: {
        vertexShader: "uniform lowp int renderType;\nuniform vec3 screenPosition;\nuniform vec2 scale;\nuniform float rotation;\nuniform sampler2D occlusionMap;\nattribute vec2 position;\nattribute vec2 uv;\nvarying vec2 vUV;\nvarying float vVisibility;\nvoid main() {\nvUV = uv;\nvec2 pos = position;\nif( renderType == 2 ) {\nvec4 visibility = texture2D( occlusionMap, vec2( 0.1, 0.1 ) );\nvisibility += texture2D( occlusionMap, vec2( 0.5, 0.1 ) );\nvisibility += texture2D( occlusionMap, vec2( 0.9, 0.1 ) );\nvisibility += texture2D( occlusionMap, vec2( 0.9, 0.5 ) );\nvisibility += texture2D( occlusionMap, vec2( 0.9, 0.9 ) );\nvisibility += texture2D( occlusionMap, vec2( 0.5, 0.9 ) );\nvisibility += texture2D( occlusionMap, vec2( 0.1, 0.9 ) );\nvisibility += texture2D( occlusionMap, vec2( 0.1, 0.5 ) );\nvisibility += texture2D( occlusionMap, vec2( 0.5, 0.5 ) );\nvVisibility =        visibility.r / 9.0;\nvVisibility *= 1.0 - visibility.g / 9.0;\nvVisibility *=       visibility.b / 9.0;\nvVisibility *= 1.0 - visibility.a / 9.0;\npos.x = cos( rotation ) * position.x - sin( rotation ) * position.y;\npos.y = sin( rotation ) * position.x + cos( rotation ) * position.y;\n}\ngl_Position = vec4( ( pos * scale + screenPosition.xy ).xy, screenPosition.z, 1.0 );\n}",
        fragmentShader: "uniform lowp int renderType;\nuniform sampler2D map;\nuniform float opacity;\nuniform vec3 color;\nvarying vec2 vUV;\nvarying float vVisibility;\nvoid main() {\nif( renderType == 0 ) {\ngl_FragColor = vec4( 1.0, 0.0, 1.0, 0.0 );\n} else if( renderType == 1 ) {\ngl_FragColor = texture2D( map, vUV );\n} else {\nvec4 texture = texture2D( map, vUV );\ntexture.a *= opacity * vVisibility;\ngl_FragColor = texture;\ngl_FragColor.rgb *= color;\n}\n}"
    },
    lensFlare: {
        vertexShader: "uniform lowp int renderType;\nuniform vec3 screenPosition;\nuniform vec2 scale;\nuniform float rotation;\nattribute vec2 position;\nattribute vec2 uv;\nvarying vec2 vUV;\nvoid main() {\nvUV = uv;\nvec2 pos = position;\nif( renderType == 2 ) {\npos.x = cos( rotation ) * position.x - sin( rotation ) * position.y;\npos.y = sin( rotation ) * position.x + cos( rotation ) * position.y;\n}\ngl_Position = vec4( ( pos * scale + screenPosition.xy ).xy, screenPosition.z, 1.0 );\n}",
        fragmentShader: "precision mediump float;\nuniform lowp int renderType;\nuniform sampler2D map;\nuniform sampler2D occlusionMap;\nuniform float opacity;\nuniform vec3 color;\nvarying vec2 vUV;\nvoid main() {\nif( renderType == 0 ) {\ngl_FragColor = vec4( texture2D( map, vUV ).rgb, 0.0 );\n} else if( renderType == 1 ) {\ngl_FragColor = texture2D( map, vUV );\n} else {\nfloat visibility = texture2D( occlusionMap, vec2( 0.5, 0.1 ) ).a;\nvisibility += texture2D( occlusionMap, vec2( 0.9, 0.5 ) ).a;\nvisibility += texture2D( occlusionMap, vec2( 0.5, 0.9 ) ).a;\nvisibility += texture2D( occlusionMap, vec2( 0.1, 0.5 ) ).a;\nvisibility = ( 1.0 - visibility / 4.0 );\nvec4 texture = texture2D( map, vUV );\ntexture.a *= opacity * visibility;\ngl_FragColor = texture;\ngl_FragColor.rgb *= color;\n}\n}"
    }
};
THREE.StereoEffect = function ( renderer ) {

    // API

    this.separation = 3;

    // internals

    var _width, _height;

    var _position = new THREE.Vector3();
    var _quaternion = new THREE.Quaternion();
    var _scale = new THREE.Vector3();

    var _cameraL = new THREE.PerspectiveCamera();
    var _cameraR = new THREE.PerspectiveCamera();

    // initialization

    renderer.autoClear = false;

    this.setSize = function ( width, height ) {

        _width = width / 2;
        _height = height;

        renderer.setSize( width, height );

    };

    this.render = function ( scene, camera ) {

        scene.updateMatrixWorld();

        if ( camera.parent === undefined ) camera.updateMatrixWorld();
    
        camera.matrixWorld.decompose( _position, _quaternion, _scale );

        // left

        _cameraL.fov = camera.fov;
        _cameraL.aspect = 0.5 * camera.aspect;
        _cameraL.near = camera.near;
        _cameraL.far = camera.far;
        _cameraL.updateProjectionMatrix();

        _cameraL.position.copy( _position );
        _cameraL.quaternion.copy( _quaternion );
        _cameraL.translateX( - this.separation );
        _cameraL.updateMatrixWorld();

        // right

        _cameraR.near = camera.near;
        _cameraR.far = camera.far;
        _cameraR.projectionMatrix = _cameraL.projectionMatrix;

        _cameraR.position.copy( _position );
        _cameraR.quaternion.copy( _quaternion );
        _cameraR.translateX( this.separation );
        _cameraR.updateMatrixWorld();

        //

        renderer.setViewport( 0, 0, _width * 2, _height );
        renderer.clear();

        renderer.setViewport( 0, 0, _width, _height );
        renderer.render( scene, _cameraL );

        renderer.setViewport( _width, 0, _width, _height );
        renderer.render( scene, _cameraR );

    };

};
THREE.OrbitControls = function ( object, domElement ) {

  this.object = object;
  this.domElement = ( domElement !== undefined ) ? domElement : document;

  // API

  // Set to false to disable this control
  this.enabled = true;

  // "target" sets the location of focus, where the control orbits around
  // and where it pans with respect to.
  this.target = new THREE.Vector3();

  // center is old, deprecated; use "target" instead
  this.center = this.target;

  // This option actually enables dollying in and out; left as "zoom" for
  // backwards compatibility
  this.noZoom = false;
  this.zoomSpeed = 1.0;

  // Limits to how far you can dolly in and out
  this.minDistance = 0;
  this.maxDistance = Infinity;

  // Set to true to disable this control
  this.noRotate = false;
  this.rotateSpeed = 1.0;

  // Set to true to disable this control
  this.noPan = false;
  this.keyPanSpeed = 7.0; // pixels moved per arrow key push

  // Set to true to automatically rotate around the target
  this.autoRotate = false;
  this.autoRotateSpeed = 2.0; // 30 seconds per round when fps is 60

  // How far you can orbit vertically, upper and lower limits.
  // Range is 0 to Math.PI radians.
  this.minPolarAngle = 0; // radians
  this.maxPolarAngle = Math.PI; // radians

  // Set to true to disable use of the keys
  this.noKeys = false;

  // The four arrow keys
  this.keys = { LEFT: 37, UP: 38, RIGHT: 39, BOTTOM: 40 };

  ////////////
  // internals

  var scope = this;

  var EPS = 0.000001;

  var rotateStart = new THREE.Vector2();
  var rotateEnd = new THREE.Vector2();
  var rotateDelta = new THREE.Vector2();

  var panStart = new THREE.Vector2();
  var panEnd = new THREE.Vector2();
  var panDelta = new THREE.Vector2();
  var panOffset = new THREE.Vector3();

  var offset = new THREE.Vector3();

  var dollyStart = new THREE.Vector2();
  var dollyEnd = new THREE.Vector2();
  var dollyDelta = new THREE.Vector2();

  var phiDelta = 0;
  var thetaDelta = 0;
  var scale = 1;
  var pan = new THREE.Vector3();

  var lastPosition = new THREE.Vector3();

  var STATE = { NONE : -1, ROTATE : 0, DOLLY : 1, PAN : 2, TOUCH_ROTATE : 3, TOUCH_DOLLY : 4, TOUCH_PAN : 5 };

  var state = STATE.NONE;

  // for reset

  this.target0 = this.target.clone();
  this.position0 = this.object.position.clone();

  // so camera.up is the orbit axis

  var quat = new THREE.Quaternion().setFromUnitVectors( object.up, new THREE.Vector3( 0, 1, 0 ) );
  var quatInverse = quat.clone().inverse();

  // events

  var changeEvent = { type: 'change' };
  var startEvent = { type: 'start'};
  var endEvent = { type: 'end'};

  this.rotateLeft = function ( angle ) {

    if ( angle === undefined ) {

      angle = getAutoRotationAngle();

    }

    thetaDelta -= angle;

  };

  this.rotateUp = function ( angle ) {

    if ( angle === undefined ) {

      angle = getAutoRotationAngle();

    }

    phiDelta -= angle;

  };

  // pass in distance in world space to move left
  this.panLeft = function ( distance ) {

    var te = this.object.matrix.elements;

    // get X column of matrix
    panOffset.set( te[ 0 ], te[ 1 ], te[ 2 ] );
    panOffset.multiplyScalar( - distance );

    pan.add( panOffset );

  };

  // pass in distance in world space to move up
  this.panUp = function ( distance ) {

    var te = this.object.matrix.elements;

    // get Y column of matrix
    panOffset.set( te[ 4 ], te[ 5 ], te[ 6 ] );
    panOffset.multiplyScalar( distance );

    pan.add( panOffset );

  };

  // pass in x,y of change desired in pixel space,
  // right and down are positive
  this.pan = function ( deltaX, deltaY ) {

    var element = scope.domElement === document ? scope.domElement.body : scope.domElement;

    if ( scope.object.fov !== undefined ) {

      // perspective
      var position = scope.object.position;
      var offset = position.clone().sub( scope.target );
      var targetDistance = offset.length();

      // half of the fov is center to top of screen
      targetDistance *= Math.tan( ( scope.object.fov / 2 ) * Math.PI / 180.0 );

      // we actually don't use screenWidth, since perspective camera is fixed to screen height
      scope.panLeft( 2 * deltaX * targetDistance / element.clientHeight );
      scope.panUp( 2 * deltaY * targetDistance / element.clientHeight );

    } else if ( scope.object.top !== undefined ) {

      // orthographic
      scope.panLeft( deltaX * (scope.object.right - scope.object.left) / element.clientWidth );
      scope.panUp( deltaY * (scope.object.top - scope.object.bottom) / element.clientHeight );

    } else {

      // camera neither orthographic or perspective
      console.warn( 'WARNING: OrbitControls.js encountered an unknown camera type - pan disabled.' );

    }

  };

  this.dollyIn = function ( dollyScale ) {

    if ( dollyScale === undefined ) {

      dollyScale = getZoomScale();

    }

    scale /= dollyScale;

  };

  this.dollyOut = function ( dollyScale ) {

    if ( dollyScale === undefined ) {

      dollyScale = getZoomScale();

    }

    scale *= dollyScale;

  };

  this.update = function () {

    var position = this.object.position;

    offset.copy( position ).sub( this.target );

    // rotate offset to "y-axis-is-up" space
    offset.applyQuaternion( quat );

    // angle from z-axis around y-axis

    var theta = Math.atan2( offset.x, offset.z );

    // angle from y-axis

    var phi = Math.atan2( Math.sqrt( offset.x * offset.x + offset.z * offset.z ), offset.y );

    if ( this.autoRotate ) {

      this.rotateLeft( getAutoRotationAngle() );

    }

    theta += thetaDelta;
    phi += phiDelta;

    // restrict phi to be between desired limits
    phi = Math.max( this.minPolarAngle, Math.min( this.maxPolarAngle, phi ) );

    // restrict phi to be betwee EPS and PI-EPS
    phi = Math.max( EPS, Math.min( Math.PI - EPS, phi ) );

    var radius = offset.length() * scale;

    // restrict radius to be between desired limits
    radius = Math.max( this.minDistance, Math.min( this.maxDistance, radius ) );

    // move target to panned location
    this.target.add( pan );

    offset.x = radius * Math.sin( phi ) * Math.sin( theta );
    offset.y = radius * Math.cos( phi );
    offset.z = radius * Math.sin( phi ) * Math.cos( theta );

    // rotate offset back to "camera-up-vector-is-up" space
    offset.applyQuaternion( quatInverse );

    position.copy( this.target ).add( offset );

    this.object.lookAt( this.target );

    thetaDelta = 0;
    phiDelta = 0;
    scale = 1;
    pan.set( 0, 0, 0 );

    if ( lastPosition.distanceToSquared( this.object.position ) > EPS ) {

      this.dispatchEvent( changeEvent );

      lastPosition.copy( this.object.position );

    }

  };


  this.reset = function () {

    state = STATE.NONE;

    this.target.copy( this.target0 );
    this.object.position.copy( this.position0 );

    this.update();

  };

  function getAutoRotationAngle() {

    return 2 * Math.PI / 60 / 60 * scope.autoRotateSpeed;

  }

  function getZoomScale() {

    return Math.pow( 0.95, scope.zoomSpeed );

  }

  function onMouseDown( event ) {

    if ( scope.enabled === false ) return;
    event.preventDefault();

    if ( event.button === 0 ) {
      if ( scope.noRotate === true ) return;

      state = STATE.ROTATE;

      rotateStart.set( event.clientX, event.clientY );

    } else if ( event.button === 1 ) {
      if ( scope.noZoom === true ) return;

      state = STATE.DOLLY;

      dollyStart.set( event.clientX, event.clientY );

    } else if ( event.button === 2 ) {
      if ( scope.noPan === true ) return;

      state = STATE.PAN;

      panStart.set( event.clientX, event.clientY );

    }

    scope.domElement.addEventListener( 'mousemove', onMouseMove, false );
    scope.domElement.addEventListener( 'mouseup', onMouseUp, false );
    scope.dispatchEvent( startEvent );

  }

  function onMouseMove( event ) {

    if ( scope.enabled === false ) return;

    event.preventDefault();

    var element = scope.domElement === document ? scope.domElement.body : scope.domElement;

    if ( state === STATE.ROTATE ) {

      if ( scope.noRotate === true ) return;

      rotateEnd.set( event.clientX, event.clientY );
      rotateDelta.subVectors( rotateEnd, rotateStart );

      // rotating across whole screen goes 360 degrees around
      scope.rotateLeft( 2 * Math.PI * rotateDelta.x / element.clientWidth * scope.rotateSpeed );

      // rotating up and down along whole screen attempts to go 360, but limited to 180
      scope.rotateUp( 2 * Math.PI * rotateDelta.y / element.clientHeight * scope.rotateSpeed );

      rotateStart.copy( rotateEnd );

    } else if ( state === STATE.DOLLY ) {

      if ( scope.noZoom === true ) return;

      dollyEnd.set( event.clientX, event.clientY );
      dollyDelta.subVectors( dollyEnd, dollyStart );

      if ( dollyDelta.y > 0 ) {

        scope.dollyIn();

      } else {

        scope.dollyOut();

      }

      dollyStart.copy( dollyEnd );

    } else if ( state === STATE.PAN ) {

      if ( scope.noPan === true ) return;

      panEnd.set( event.clientX, event.clientY );
      panDelta.subVectors( panEnd, panStart );

      scope.pan( panDelta.x, panDelta.y );

      panStart.copy( panEnd );

    }

    scope.update();

  }

  function onMouseUp( /* event */ ) {

    if ( scope.enabled === false ) return;

    scope.domElement.removeEventListener( 'mousemove', onMouseMove, false );
    scope.domElement.removeEventListener( 'mouseup', onMouseUp, false );
    scope.dispatchEvent( endEvent );
    state = STATE.NONE;

  }

  function onMouseWheel( event ) {

    if ( scope.enabled === false || scope.noZoom === true ) return;

    event.preventDefault();
    event.stopPropagation();

    var delta = 0;

    if ( event.wheelDelta !== undefined ) { // WebKit / Opera / Explorer 9

      delta = event.wheelDelta;

    } else if ( event.detail !== undefined ) { // Firefox

      delta = - event.detail;

    }

    if ( delta > 0 ) {

      scope.dollyOut();

    } else {

      scope.dollyIn();

    }

    scope.update();
    scope.dispatchEvent( startEvent );
    scope.dispatchEvent( endEvent );

  }

  function onKeyDown( event ) {

    if ( scope.enabled === false || scope.noKeys === true || scope.noPan === true ) return;

    switch ( event.keyCode ) {

      case scope.keys.UP:
        scope.pan( 0, scope.keyPanSpeed );
        scope.update();
        break;

      case scope.keys.BOTTOM:
        scope.pan( 0, - scope.keyPanSpeed );
        scope.update();
        break;

      case scope.keys.LEFT:
        scope.pan( scope.keyPanSpeed, 0 );
        scope.update();
        break;

      case scope.keys.RIGHT:
        scope.pan( - scope.keyPanSpeed, 0 );
        scope.update();
        break;

    }

  }

  function touchstart( event ) {

    if ( scope.enabled === false ) return;

    switch ( event.touches.length ) {

      case 1: // one-fingered touch: rotate

        if ( scope.noRotate === true ) return;

        state = STATE.TOUCH_ROTATE;

        rotateStart.set( event.touches[ 0 ].pageX, event.touches[ 0 ].pageY );
        break;

      case 2: // two-fingered touch: dolly

        if ( scope.noZoom === true ) return;

        state = STATE.TOUCH_DOLLY;

        var dx = event.touches[ 0 ].pageX - event.touches[ 1 ].pageX;
        var dy = event.touches[ 0 ].pageY - event.touches[ 1 ].pageY;
        var distance = Math.sqrt( dx * dx + dy * dy );
        dollyStart.set( 0, distance );
        break;

      case 3: // three-fingered touch: pan

        if ( scope.noPan === true ) return;

        state = STATE.TOUCH_PAN;

        panStart.set( event.touches[ 0 ].pageX, event.touches[ 0 ].pageY );
        break;

      default:

        state = STATE.NONE;

    }

    scope.dispatchEvent( startEvent );

  }

  function touchmove( event ) {

    if ( scope.enabled === false ) return;

    event.preventDefault();
    event.stopPropagation();

    var element = scope.domElement === document ? scope.domElement.body : scope.domElement;

    switch ( event.touches.length ) {

      case 1: // one-fingered touch: rotate

        if ( scope.noRotate === true ) return;
        if ( state !== STATE.TOUCH_ROTATE ) return;

        rotateEnd.set( event.touches[ 0 ].pageX, event.touches[ 0 ].pageY );
        rotateDelta.subVectors( rotateEnd, rotateStart );

        // rotating across whole screen goes 360 degrees around
        scope.rotateLeft( 2 * Math.PI * rotateDelta.x / element.clientWidth * scope.rotateSpeed );
        // rotating up and down along whole screen attempts to go 360, but limited to 180
        scope.rotateUp( 2 * Math.PI * rotateDelta.y / element.clientHeight * scope.rotateSpeed );

        rotateStart.copy( rotateEnd );

        scope.update();
        break;

      case 2: // two-fingered touch: dolly

        if ( scope.noZoom === true ) return;
        if ( state !== STATE.TOUCH_DOLLY ) return;

        var dx = event.touches[ 0 ].pageX - event.touches[ 1 ].pageX;
        var dy = event.touches[ 0 ].pageY - event.touches[ 1 ].pageY;
        var distance = Math.sqrt( dx * dx + dy * dy );

        dollyEnd.set( 0, distance );
        dollyDelta.subVectors( dollyEnd, dollyStart );

        if ( dollyDelta.y > 0 ) {

          scope.dollyOut();

        } else {

          scope.dollyIn();

        }

        dollyStart.copy( dollyEnd );

        scope.update();
        break;

      case 3: // three-fingered touch: pan

        if ( scope.noPan === true ) return;
        if ( state !== STATE.TOUCH_PAN ) return;

        panEnd.set( event.touches[ 0 ].pageX, event.touches[ 0 ].pageY );
        panDelta.subVectors( panEnd, panStart );

        scope.pan( panDelta.x, panDelta.y );

        panStart.copy( panEnd );

        scope.update();
        break;

      default:

        state = STATE.NONE;

    }

  }

  function touchend( /* event */ ) {

    if ( scope.enabled === false ) return;

    scope.dispatchEvent( endEvent );
    state = STATE.NONE;

  }

  this.domElement.addEventListener( 'contextmenu', function ( event ) { event.preventDefault(); }, false );
  this.domElement.addEventListener( 'mousedown', onMouseDown, false );
  this.domElement.addEventListener( 'mousewheel', onMouseWheel, false );
  this.domElement.addEventListener( 'DOMMouseScroll', onMouseWheel, false ); // firefox

  this.domElement.addEventListener( 'touchstart', touchstart, false );
  this.domElement.addEventListener( 'touchend', touchend, false );
  this.domElement.addEventListener( 'touchmove', touchmove, false );

  window.addEventListener( 'keydown', onKeyDown, false );

  // force an update at start
  this.update();

};

THREE.OrbitControls.prototype = Object.create( THREE.EventDispatcher.prototype );

THREE.OrbitControls = function ( object, domElement ) {

  this.object = object;
  this.domElement = ( domElement !== undefined ) ? domElement : document;

  // API

  // Set to false to disable this control
  this.enabled = true;

  // "target" sets the location of focus, where the control orbits around
  // and where it pans with respect to.
  this.target = new THREE.Vector3();

  // center is old, deprecated; use "target" instead
  this.center = this.target;

  // This option actually enables dollying in and out; left as "zoom" for
  // backwards compatibility
  this.noZoom = false;
  this.zoomSpeed = 1.0;

  // Limits to how far you can dolly in and out
  this.minDistance = 0;
  this.maxDistance = Infinity;

  // Set to true to disable this control
  this.noRotate = false;
  this.rotateSpeed = 1.0;

  // Set to true to disable this control
  this.noPan = false;
  this.keyPanSpeed = 7.0; // pixels moved per arrow key push

  // Set to true to automatically rotate around the target
  this.autoRotate = false;
  this.autoRotateSpeed = 2.0; // 30 seconds per round when fps is 60

  // How far you can orbit vertically, upper and lower limits.
  // Range is 0 to Math.PI radians.
  this.minPolarAngle = 0; // radians
  this.maxPolarAngle = Math.PI; // radians

  // Set to true to disable use of the keys
  this.noKeys = false;

  // The four arrow keys
  this.keys = { LEFT: 37, UP: 38, RIGHT: 39, BOTTOM: 40 };

  ////////////
  // internals

  var scope = this;

  var EPS = 0.000001;

  var rotateStart = new THREE.Vector2();
  var rotateEnd = new THREE.Vector2();
  var rotateDelta = new THREE.Vector2();

  var panStart = new THREE.Vector2();
  var panEnd = new THREE.Vector2();
  var panDelta = new THREE.Vector2();
  var panOffset = new THREE.Vector3();

  var offset = new THREE.Vector3();

  var dollyStart = new THREE.Vector2();
  var dollyEnd = new THREE.Vector2();
  var dollyDelta = new THREE.Vector2();

  var phiDelta = 0;
  var thetaDelta = 0;
  var scale = 1;
  var pan = new THREE.Vector3();

  var lastPosition = new THREE.Vector3();

  var STATE = { NONE : -1, ROTATE : 0, DOLLY : 1, PAN : 2, TOUCH_ROTATE : 3, TOUCH_DOLLY : 4, TOUCH_PAN : 5 };

  var state = STATE.NONE;

  // for reset

  this.target0 = this.target.clone();
  this.position0 = this.object.position.clone();

  // so camera.up is the orbit axis

  var quat = new THREE.Quaternion().setFromUnitVectors( object.up, new THREE.Vector3( 0, 1, 0 ) );
  var quatInverse = quat.clone().inverse();

  // events

  var changeEvent = { type: 'change' };
  var startEvent = { type: 'start'};
  var endEvent = { type: 'end'};

  this.rotateLeft = function ( angle ) {

    if ( angle === undefined ) {

      angle = getAutoRotationAngle();

    }

    thetaDelta -= angle;

  };

  this.rotateUp = function ( angle ) {

    if ( angle === undefined ) {

      angle = getAutoRotationAngle();

    }

    phiDelta -= angle;

  };

  // pass in distance in world space to move left
  this.panLeft = function ( distance ) {

    var te = this.object.matrix.elements;

    // get X column of matrix
    panOffset.set( te[ 0 ], te[ 1 ], te[ 2 ] );
    panOffset.multiplyScalar( - distance );

    pan.add( panOffset );

  };

  // pass in distance in world space to move up
  this.panUp = function ( distance ) {

    var te = this.object.matrix.elements;

    // get Y column of matrix
    panOffset.set( te[ 4 ], te[ 5 ], te[ 6 ] );
    panOffset.multiplyScalar( distance );

    pan.add( panOffset );

  };

  // pass in x,y of change desired in pixel space,
  // right and down are positive
  this.pan = function ( deltaX, deltaY ) {

    var element = scope.domElement === document ? scope.domElement.body : scope.domElement;

    if ( scope.object.fov !== undefined ) {

      // perspective
      var position = scope.object.position;
      var offset = position.clone().sub( scope.target );
      var targetDistance = offset.length();

      // half of the fov is center to top of screen
      targetDistance *= Math.tan( ( scope.object.fov / 2 ) * Math.PI / 180.0 );

      // we actually don't use screenWidth, since perspective camera is fixed to screen height
      scope.panLeft( 2 * deltaX * targetDistance / element.clientHeight );
      scope.panUp( 2 * deltaY * targetDistance / element.clientHeight );

    } else if ( scope.object.top !== undefined ) {

      // orthographic
      scope.panLeft( deltaX * (scope.object.right - scope.object.left) / element.clientWidth );
      scope.panUp( deltaY * (scope.object.top - scope.object.bottom) / element.clientHeight );

    } else {

      // camera neither orthographic or perspective
      console.warn( 'WARNING: OrbitControls.js encountered an unknown camera type - pan disabled.' );

    }

  };

  this.dollyIn = function ( dollyScale ) {

    if ( dollyScale === undefined ) {

      dollyScale = getZoomScale();

    }

    scale /= dollyScale;

  };

  this.dollyOut = function ( dollyScale ) {

    if ( dollyScale === undefined ) {

      dollyScale = getZoomScale();

    }

    scale *= dollyScale;

  };

  this.update = function () {

    var position = this.object.position;

    offset.copy( position ).sub( this.target );

    // rotate offset to "y-axis-is-up" space
    offset.applyQuaternion( quat );

    // angle from z-axis around y-axis

    var theta = Math.atan2( offset.x, offset.z );

    // angle from y-axis

    var phi = Math.atan2( Math.sqrt( offset.x * offset.x + offset.z * offset.z ), offset.y );

    if ( this.autoRotate ) {

      this.rotateLeft( getAutoRotationAngle() );

    }

    theta += thetaDelta;
    phi += phiDelta;

    // restrict phi to be between desired limits
    phi = Math.max( this.minPolarAngle, Math.min( this.maxPolarAngle, phi ) );

    // restrict phi to be betwee EPS and PI-EPS
    phi = Math.max( EPS, Math.min( Math.PI - EPS, phi ) );

    var radius = offset.length() * scale;

    // restrict radius to be between desired limits
    radius = Math.max( this.minDistance, Math.min( this.maxDistance, radius ) );

    // move target to panned location
    this.target.add( pan );

    offset.x = radius * Math.sin( phi ) * Math.sin( theta );
    offset.y = radius * Math.cos( phi );
    offset.z = radius * Math.sin( phi ) * Math.cos( theta );

    // rotate offset back to "camera-up-vector-is-up" space
    offset.applyQuaternion( quatInverse );

    position.copy( this.target ).add( offset );

    this.object.lookAt( this.target );

    thetaDelta = 0;
    phiDelta = 0;
    scale = 1;
    pan.set( 0, 0, 0 );

    if ( lastPosition.distanceToSquared( this.object.position ) > EPS ) {

      this.dispatchEvent( changeEvent );

      lastPosition.copy( this.object.position );

    }

  };


  this.reset = function () {

    state = STATE.NONE;

    this.target.copy( this.target0 );
    this.object.position.copy( this.position0 );

    this.update();

  };

  function getAutoRotationAngle() {

    return 2 * Math.PI / 60 / 60 * scope.autoRotateSpeed;

  }

  function getZoomScale() {

    return Math.pow( 0.95, scope.zoomSpeed );

  }

  function onMouseDown( event ) {

    if ( scope.enabled === false ) return;
    event.preventDefault();

    if ( event.button === 0 ) {
      if ( scope.noRotate === true ) return;

      state = STATE.ROTATE;

      rotateStart.set( event.clientX, event.clientY );

    } else if ( event.button === 1 ) {
      if ( scope.noZoom === true ) return;

      state = STATE.DOLLY;

      dollyStart.set( event.clientX, event.clientY );

    } else if ( event.button === 2 ) {
      if ( scope.noPan === true ) return;

      state = STATE.PAN;

      panStart.set( event.clientX, event.clientY );

    }

    scope.domElement.addEventListener( 'mousemove', onMouseMove, false );
    scope.domElement.addEventListener( 'mouseup', onMouseUp, false );
    scope.dispatchEvent( startEvent );

  }

  function onMouseMove( event ) {

    if ( scope.enabled === false ) return;

    event.preventDefault();

    var element = scope.domElement === document ? scope.domElement.body : scope.domElement;

    if ( state === STATE.ROTATE ) {

      if ( scope.noRotate === true ) return;

      rotateEnd.set( event.clientX, event.clientY );
      rotateDelta.subVectors( rotateEnd, rotateStart );

      // rotating across whole screen goes 360 degrees around
      scope.rotateLeft( 2 * Math.PI * rotateDelta.x / element.clientWidth * scope.rotateSpeed );

      // rotating up and down along whole screen attempts to go 360, but limited to 180
      scope.rotateUp( 2 * Math.PI * rotateDelta.y / element.clientHeight * scope.rotateSpeed );

      rotateStart.copy( rotateEnd );

    } else if ( state === STATE.DOLLY ) {

      if ( scope.noZoom === true ) return;

      dollyEnd.set( event.clientX, event.clientY );
      dollyDelta.subVectors( dollyEnd, dollyStart );

      if ( dollyDelta.y > 0 ) {

        scope.dollyIn();

      } else {

        scope.dollyOut();

      }

      dollyStart.copy( dollyEnd );

    } else if ( state === STATE.PAN ) {

      if ( scope.noPan === true ) return;

      panEnd.set( event.clientX, event.clientY );
      panDelta.subVectors( panEnd, panStart );

      scope.pan( panDelta.x, panDelta.y );

      panStart.copy( panEnd );

    }

    scope.update();

  }

  function onMouseUp( /* event */ ) {

    if ( scope.enabled === false ) return;

    scope.domElement.removeEventListener( 'mousemove', onMouseMove, false );
    scope.domElement.removeEventListener( 'mouseup', onMouseUp, false );
    scope.dispatchEvent( endEvent );
    state = STATE.NONE;

  }

  function onMouseWheel( event ) {

    if ( scope.enabled === false || scope.noZoom === true ) return;

    event.preventDefault();
    event.stopPropagation();

    var delta = 0;

    if ( event.wheelDelta !== undefined ) { // WebKit / Opera / Explorer 9

      delta = event.wheelDelta;

    } else if ( event.detail !== undefined ) { // Firefox

      delta = - event.detail;

    }

    if ( delta > 0 ) {

      scope.dollyOut();

    } else {

      scope.dollyIn();

    }

    scope.update();
    scope.dispatchEvent( startEvent );
    scope.dispatchEvent( endEvent );

  }

  function onKeyDown( event ) {

    if ( scope.enabled === false || scope.noKeys === true || scope.noPan === true ) return;

    switch ( event.keyCode ) {

      case scope.keys.UP:
        scope.pan( 0, scope.keyPanSpeed );
        scope.update();
        break;

      case scope.keys.BOTTOM:
        scope.pan( 0, - scope.keyPanSpeed );
        scope.update();
        break;

      case scope.keys.LEFT:
        scope.pan( scope.keyPanSpeed, 0 );
        scope.update();
        break;

      case scope.keys.RIGHT:
        scope.pan( - scope.keyPanSpeed, 0 );
        scope.update();
        break;

    }

  }

  function touchstart( event ) {

    if ( scope.enabled === false ) return;

    switch ( event.touches.length ) {

      case 1: // one-fingered touch: rotate

        if ( scope.noRotate === true ) return;

        state = STATE.TOUCH_ROTATE;

        rotateStart.set( event.touches[ 0 ].pageX, event.touches[ 0 ].pageY );
        break;

      case 2: // two-fingered touch: dolly

        if ( scope.noZoom === true ) return;

        state = STATE.TOUCH_DOLLY;

        var dx = event.touches[ 0 ].pageX - event.touches[ 1 ].pageX;
        var dy = event.touches[ 0 ].pageY - event.touches[ 1 ].pageY;
        var distance = Math.sqrt( dx * dx + dy * dy );
        dollyStart.set( 0, distance );
        break;

      case 3: // three-fingered touch: pan

        if ( scope.noPan === true ) return;

        state = STATE.TOUCH_PAN;

        panStart.set( event.touches[ 0 ].pageX, event.touches[ 0 ].pageY );
        break;

      default:

        state = STATE.NONE;

    }

    scope.dispatchEvent( startEvent );

  }

  function touchmove( event ) {

    if ( scope.enabled === false ) return;

    event.preventDefault();
    event.stopPropagation();

    var element = scope.domElement === document ? scope.domElement.body : scope.domElement;

    switch ( event.touches.length ) {

      case 1: // one-fingered touch: rotate

        if ( scope.noRotate === true ) return;
        if ( state !== STATE.TOUCH_ROTATE ) return;

        rotateEnd.set( event.touches[ 0 ].pageX, event.touches[ 0 ].pageY );
        rotateDelta.subVectors( rotateEnd, rotateStart );

        // rotating across whole screen goes 360 degrees around
        scope.rotateLeft( 2 * Math.PI * rotateDelta.x / element.clientWidth * scope.rotateSpeed );
        // rotating up and down along whole screen attempts to go 360, but limited to 180
        scope.rotateUp( 2 * Math.PI * rotateDelta.y / element.clientHeight * scope.rotateSpeed );

        rotateStart.copy( rotateEnd );

        scope.update();
        break;

      case 2: // two-fingered touch: dolly

        if ( scope.noZoom === true ) return;
        if ( state !== STATE.TOUCH_DOLLY ) return;

        var dx = event.touches[ 0 ].pageX - event.touches[ 1 ].pageX;
        var dy = event.touches[ 0 ].pageY - event.touches[ 1 ].pageY;
        var distance = Math.sqrt( dx * dx + dy * dy );

        dollyEnd.set( 0, distance );
        dollyDelta.subVectors( dollyEnd, dollyStart );

        if ( dollyDelta.y > 0 ) {

          scope.dollyOut();

        } else {

          scope.dollyIn();

        }

        dollyStart.copy( dollyEnd );

        scope.update();
        break;

      case 3: // three-fingered touch: pan

        if ( scope.noPan === true ) return;
        if ( state !== STATE.TOUCH_PAN ) return;

        panEnd.set( event.touches[ 0 ].pageX, event.touches[ 0 ].pageY );
        panDelta.subVectors( panEnd, panStart );

        scope.pan( panDelta.x, panDelta.y );

        panStart.copy( panEnd );

        scope.update();
        break;

      default:

        state = STATE.NONE;

    }

  }

  function touchend( /* event */ ) {

    if ( scope.enabled === false ) return;

    scope.dispatchEvent( endEvent );
    state = STATE.NONE;

  }

  this.domElement.addEventListener( 'contextmenu', function ( event ) { event.preventDefault(); }, false );
  this.domElement.addEventListener( 'mousedown', onMouseDown, false );
  this.domElement.addEventListener( 'mousewheel', onMouseWheel, false );
  this.domElement.addEventListener( 'DOMMouseScroll', onMouseWheel, false ); // firefox

  this.domElement.addEventListener( 'touchstart', touchstart, false );
  this.domElement.addEventListener( 'touchend', touchend, false );
  this.domElement.addEventListener( 'touchmove', touchmove, false );

  window.addEventListener( 'keydown', onKeyDown, false );

  // force an update at start
  this.update();

};

THREE.OrbitControls.prototype = Object.create( THREE.EventDispatcher.prototype );

module.exports = THREE;
}).call(this,require("1YiZ5S"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../node_modules/three-vr/src/index.js","/../node_modules/three-vr/src")
},{"1YiZ5S":4,"buffer":1}],6:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
//     Underscore.js 1.7.0
//     http://underscorejs.org
//     (c) 2009-2014 Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
//     Underscore may be freely distributed under the MIT license.

(function() {

  // Baseline setup
  // --------------

  // Establish the root object, `window` in the browser, or `exports` on the server.
  var root = this;

  // Save the previous value of the `_` variable.
  var previousUnderscore = root._;

  // Save bytes in the minified (but not gzipped) version:
  var ArrayProto = Array.prototype, ObjProto = Object.prototype, FuncProto = Function.prototype;

  // Create quick reference variables for speed access to core prototypes.
  var
    push             = ArrayProto.push,
    slice            = ArrayProto.slice,
    concat           = ArrayProto.concat,
    toString         = ObjProto.toString,
    hasOwnProperty   = ObjProto.hasOwnProperty;

  // All **ECMAScript 5** native function implementations that we hope to use
  // are declared here.
  var
    nativeIsArray      = Array.isArray,
    nativeKeys         = Object.keys,
    nativeBind         = FuncProto.bind;

  // Create a safe reference to the Underscore object for use below.
  var _ = function(obj) {
    if (obj instanceof _) return obj;
    if (!(this instanceof _)) return new _(obj);
    this._wrapped = obj;
  };

  // Export the Underscore object for **Node.js**, with
  // backwards-compatibility for the old `require()` API. If we're in
  // the browser, add `_` as a global object.
  if (typeof exports !== 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      exports = module.exports = _;
    }
    exports._ = _;
  } else {
    root._ = _;
  }

  // Current version.
  _.VERSION = '1.7.0';

  // Internal function that returns an efficient (for current engines) version
  // of the passed-in callback, to be repeatedly applied in other Underscore
  // functions.
  var createCallback = function(func, context, argCount) {
    if (context === void 0) return func;
    switch (argCount == null ? 3 : argCount) {
      case 1: return function(value) {
        return func.call(context, value);
      };
      case 2: return function(value, other) {
        return func.call(context, value, other);
      };
      case 3: return function(value, index, collection) {
        return func.call(context, value, index, collection);
      };
      case 4: return function(accumulator, value, index, collection) {
        return func.call(context, accumulator, value, index, collection);
      };
    }
    return function() {
      return func.apply(context, arguments);
    };
  };

  // A mostly-internal function to generate callbacks that can be applied
  // to each element in a collection, returning the desired result — either
  // identity, an arbitrary callback, a property matcher, or a property accessor.
  _.iteratee = function(value, context, argCount) {
    if (value == null) return _.identity;
    if (_.isFunction(value)) return createCallback(value, context, argCount);
    if (_.isObject(value)) return _.matches(value);
    return _.property(value);
  };

  // Collection Functions
  // --------------------

  // The cornerstone, an `each` implementation, aka `forEach`.
  // Handles raw objects in addition to array-likes. Treats all
  // sparse array-likes as if they were dense.
  _.each = _.forEach = function(obj, iteratee, context) {
    if (obj == null) return obj;
    iteratee = createCallback(iteratee, context);
    var i, length = obj.length;
    if (length === +length) {
      for (i = 0; i < length; i++) {
        iteratee(obj[i], i, obj);
      }
    } else {
      var keys = _.keys(obj);
      for (i = 0, length = keys.length; i < length; i++) {
        iteratee(obj[keys[i]], keys[i], obj);
      }
    }
    return obj;
  };

  // Return the results of applying the iteratee to each element.
  _.map = _.collect = function(obj, iteratee, context) {
    if (obj == null) return [];
    iteratee = _.iteratee(iteratee, context);
    var keys = obj.length !== +obj.length && _.keys(obj),
        length = (keys || obj).length,
        results = Array(length),
        currentKey;
    for (var index = 0; index < length; index++) {
      currentKey = keys ? keys[index] : index;
      results[index] = iteratee(obj[currentKey], currentKey, obj);
    }
    return results;
  };

  var reduceError = 'Reduce of empty array with no initial value';

  // **Reduce** builds up a single result from a list of values, aka `inject`,
  // or `foldl`.
  _.reduce = _.foldl = _.inject = function(obj, iteratee, memo, context) {
    if (obj == null) obj = [];
    iteratee = createCallback(iteratee, context, 4);
    var keys = obj.length !== +obj.length && _.keys(obj),
        length = (keys || obj).length,
        index = 0, currentKey;
    if (arguments.length < 3) {
      if (!length) throw new TypeError(reduceError);
      memo = obj[keys ? keys[index++] : index++];
    }
    for (; index < length; index++) {
      currentKey = keys ? keys[index] : index;
      memo = iteratee(memo, obj[currentKey], currentKey, obj);
    }
    return memo;
  };

  // The right-associative version of reduce, also known as `foldr`.
  _.reduceRight = _.foldr = function(obj, iteratee, memo, context) {
    if (obj == null) obj = [];
    iteratee = createCallback(iteratee, context, 4);
    var keys = obj.length !== + obj.length && _.keys(obj),
        index = (keys || obj).length,
        currentKey;
    if (arguments.length < 3) {
      if (!index) throw new TypeError(reduceError);
      memo = obj[keys ? keys[--index] : --index];
    }
    while (index--) {
      currentKey = keys ? keys[index] : index;
      memo = iteratee(memo, obj[currentKey], currentKey, obj);
    }
    return memo;
  };

  // Return the first value which passes a truth test. Aliased as `detect`.
  _.find = _.detect = function(obj, predicate, context) {
    var result;
    predicate = _.iteratee(predicate, context);
    _.some(obj, function(value, index, list) {
      if (predicate(value, index, list)) {
        result = value;
        return true;
      }
    });
    return result;
  };

  // Return all the elements that pass a truth test.
  // Aliased as `select`.
  _.filter = _.select = function(obj, predicate, context) {
    var results = [];
    if (obj == null) return results;
    predicate = _.iteratee(predicate, context);
    _.each(obj, function(value, index, list) {
      if (predicate(value, index, list)) results.push(value);
    });
    return results;
  };

  // Return all the elements for which a truth test fails.
  _.reject = function(obj, predicate, context) {
    return _.filter(obj, _.negate(_.iteratee(predicate)), context);
  };

  // Determine whether all of the elements match a truth test.
  // Aliased as `all`.
  _.every = _.all = function(obj, predicate, context) {
    if (obj == null) return true;
    predicate = _.iteratee(predicate, context);
    var keys = obj.length !== +obj.length && _.keys(obj),
        length = (keys || obj).length,
        index, currentKey;
    for (index = 0; index < length; index++) {
      currentKey = keys ? keys[index] : index;
      if (!predicate(obj[currentKey], currentKey, obj)) return false;
    }
    return true;
  };

  // Determine if at least one element in the object matches a truth test.
  // Aliased as `any`.
  _.some = _.any = function(obj, predicate, context) {
    if (obj == null) return false;
    predicate = _.iteratee(predicate, context);
    var keys = obj.length !== +obj.length && _.keys(obj),
        length = (keys || obj).length,
        index, currentKey;
    for (index = 0; index < length; index++) {
      currentKey = keys ? keys[index] : index;
      if (predicate(obj[currentKey], currentKey, obj)) return true;
    }
    return false;
  };

  // Determine if the array or object contains a given value (using `===`).
  // Aliased as `include`.
  _.contains = _.include = function(obj, target) {
    if (obj == null) return false;
    if (obj.length !== +obj.length) obj = _.values(obj);
    return _.indexOf(obj, target) >= 0;
  };

  // Invoke a method (with arguments) on every item in a collection.
  _.invoke = function(obj, method) {
    var args = slice.call(arguments, 2);
    var isFunc = _.isFunction(method);
    return _.map(obj, function(value) {
      return (isFunc ? method : value[method]).apply(value, args);
    });
  };

  // Convenience version of a common use case of `map`: fetching a property.
  _.pluck = function(obj, key) {
    return _.map(obj, _.property(key));
  };

  // Convenience version of a common use case of `filter`: selecting only objects
  // containing specific `key:value` pairs.
  _.where = function(obj, attrs) {
    return _.filter(obj, _.matches(attrs));
  };

  // Convenience version of a common use case of `find`: getting the first object
  // containing specific `key:value` pairs.
  _.findWhere = function(obj, attrs) {
    return _.find(obj, _.matches(attrs));
  };

  // Return the maximum element (or element-based computation).
  _.max = function(obj, iteratee, context) {
    var result = -Infinity, lastComputed = -Infinity,
        value, computed;
    if (iteratee == null && obj != null) {
      obj = obj.length === +obj.length ? obj : _.values(obj);
      for (var i = 0, length = obj.length; i < length; i++) {
        value = obj[i];
        if (value > result) {
          result = value;
        }
      }
    } else {
      iteratee = _.iteratee(iteratee, context);
      _.each(obj, function(value, index, list) {
        computed = iteratee(value, index, list);
        if (computed > lastComputed || computed === -Infinity && result === -Infinity) {
          result = value;
          lastComputed = computed;
        }
      });
    }
    return result;
  };

  // Return the minimum element (or element-based computation).
  _.min = function(obj, iteratee, context) {
    var result = Infinity, lastComputed = Infinity,
        value, computed;
    if (iteratee == null && obj != null) {
      obj = obj.length === +obj.length ? obj : _.values(obj);
      for (var i = 0, length = obj.length; i < length; i++) {
        value = obj[i];
        if (value < result) {
          result = value;
        }
      }
    } else {
      iteratee = _.iteratee(iteratee, context);
      _.each(obj, function(value, index, list) {
        computed = iteratee(value, index, list);
        if (computed < lastComputed || computed === Infinity && result === Infinity) {
          result = value;
          lastComputed = computed;
        }
      });
    }
    return result;
  };

  // Shuffle a collection, using the modern version of the
  // [Fisher-Yates shuffle](http://en.wikipedia.org/wiki/Fisher–Yates_shuffle).
  _.shuffle = function(obj) {
    var set = obj && obj.length === +obj.length ? obj : _.values(obj);
    var length = set.length;
    var shuffled = Array(length);
    for (var index = 0, rand; index < length; index++) {
      rand = _.random(0, index);
      if (rand !== index) shuffled[index] = shuffled[rand];
      shuffled[rand] = set[index];
    }
    return shuffled;
  };

  // Sample **n** random values from a collection.
  // If **n** is not specified, returns a single random element.
  // The internal `guard` argument allows it to work with `map`.
  _.sample = function(obj, n, guard) {
    if (n == null || guard) {
      if (obj.length !== +obj.length) obj = _.values(obj);
      return obj[_.random(obj.length - 1)];
    }
    return _.shuffle(obj).slice(0, Math.max(0, n));
  };

  // Sort the object's values by a criterion produced by an iteratee.
  _.sortBy = function(obj, iteratee, context) {
    iteratee = _.iteratee(iteratee, context);
    return _.pluck(_.map(obj, function(value, index, list) {
      return {
        value: value,
        index: index,
        criteria: iteratee(value, index, list)
      };
    }).sort(function(left, right) {
      var a = left.criteria;
      var b = right.criteria;
      if (a !== b) {
        if (a > b || a === void 0) return 1;
        if (a < b || b === void 0) return -1;
      }
      return left.index - right.index;
    }), 'value');
  };

  // An internal function used for aggregate "group by" operations.
  var group = function(behavior) {
    return function(obj, iteratee, context) {
      var result = {};
      iteratee = _.iteratee(iteratee, context);
      _.each(obj, function(value, index) {
        var key = iteratee(value, index, obj);
        behavior(result, value, key);
      });
      return result;
    };
  };

  // Groups the object's values by a criterion. Pass either a string attribute
  // to group by, or a function that returns the criterion.
  _.groupBy = group(function(result, value, key) {
    if (_.has(result, key)) result[key].push(value); else result[key] = [value];
  });

  // Indexes the object's values by a criterion, similar to `groupBy`, but for
  // when you know that your index values will be unique.
  _.indexBy = group(function(result, value, key) {
    result[key] = value;
  });

  // Counts instances of an object that group by a certain criterion. Pass
  // either a string attribute to count by, or a function that returns the
  // criterion.
  _.countBy = group(function(result, value, key) {
    if (_.has(result, key)) result[key]++; else result[key] = 1;
  });

  // Use a comparator function to figure out the smallest index at which
  // an object should be inserted so as to maintain order. Uses binary search.
  _.sortedIndex = function(array, obj, iteratee, context) {
    iteratee = _.iteratee(iteratee, context, 1);
    var value = iteratee(obj);
    var low = 0, high = array.length;
    while (low < high) {
      var mid = low + high >>> 1;
      if (iteratee(array[mid]) < value) low = mid + 1; else high = mid;
    }
    return low;
  };

  // Safely create a real, live array from anything iterable.
  _.toArray = function(obj) {
    if (!obj) return [];
    if (_.isArray(obj)) return slice.call(obj);
    if (obj.length === +obj.length) return _.map(obj, _.identity);
    return _.values(obj);
  };

  // Return the number of elements in an object.
  _.size = function(obj) {
    if (obj == null) return 0;
    return obj.length === +obj.length ? obj.length : _.keys(obj).length;
  };

  // Split a collection into two arrays: one whose elements all satisfy the given
  // predicate, and one whose elements all do not satisfy the predicate.
  _.partition = function(obj, predicate, context) {
    predicate = _.iteratee(predicate, context);
    var pass = [], fail = [];
    _.each(obj, function(value, key, obj) {
      (predicate(value, key, obj) ? pass : fail).push(value);
    });
    return [pass, fail];
  };

  // Array Functions
  // ---------------

  // Get the first element of an array. Passing **n** will return the first N
  // values in the array. Aliased as `head` and `take`. The **guard** check
  // allows it to work with `_.map`.
  _.first = _.head = _.take = function(array, n, guard) {
    if (array == null) return void 0;
    if (n == null || guard) return array[0];
    if (n < 0) return [];
    return slice.call(array, 0, n);
  };

  // Returns everything but the last entry of the array. Especially useful on
  // the arguments object. Passing **n** will return all the values in
  // the array, excluding the last N. The **guard** check allows it to work with
  // `_.map`.
  _.initial = function(array, n, guard) {
    return slice.call(array, 0, Math.max(0, array.length - (n == null || guard ? 1 : n)));
  };

  // Get the last element of an array. Passing **n** will return the last N
  // values in the array. The **guard** check allows it to work with `_.map`.
  _.last = function(array, n, guard) {
    if (array == null) return void 0;
    if (n == null || guard) return array[array.length - 1];
    return slice.call(array, Math.max(array.length - n, 0));
  };

  // Returns everything but the first entry of the array. Aliased as `tail` and `drop`.
  // Especially useful on the arguments object. Passing an **n** will return
  // the rest N values in the array. The **guard**
  // check allows it to work with `_.map`.
  _.rest = _.tail = _.drop = function(array, n, guard) {
    return slice.call(array, n == null || guard ? 1 : n);
  };

  // Trim out all falsy values from an array.
  _.compact = function(array) {
    return _.filter(array, _.identity);
  };

  // Internal implementation of a recursive `flatten` function.
  var flatten = function(input, shallow, strict, output) {
    if (shallow && _.every(input, _.isArray)) {
      return concat.apply(output, input);
    }
    for (var i = 0, length = input.length; i < length; i++) {
      var value = input[i];
      if (!_.isArray(value) && !_.isArguments(value)) {
        if (!strict) output.push(value);
      } else if (shallow) {
        push.apply(output, value);
      } else {
        flatten(value, shallow, strict, output);
      }
    }
    return output;
  };

  // Flatten out an array, either recursively (by default), or just one level.
  _.flatten = function(array, shallow) {
    return flatten(array, shallow, false, []);
  };

  // Return a version of the array that does not contain the specified value(s).
  _.without = function(array) {
    return _.difference(array, slice.call(arguments, 1));
  };

  // Produce a duplicate-free version of the array. If the array has already
  // been sorted, you have the option of using a faster algorithm.
  // Aliased as `unique`.
  _.uniq = _.unique = function(array, isSorted, iteratee, context) {
    if (array == null) return [];
    if (!_.isBoolean(isSorted)) {
      context = iteratee;
      iteratee = isSorted;
      isSorted = false;
    }
    if (iteratee != null) iteratee = _.iteratee(iteratee, context);
    var result = [];
    var seen = [];
    for (var i = 0, length = array.length; i < length; i++) {
      var value = array[i];
      if (isSorted) {
        if (!i || seen !== value) result.push(value);
        seen = value;
      } else if (iteratee) {
        var computed = iteratee(value, i, array);
        if (_.indexOf(seen, computed) < 0) {
          seen.push(computed);
          result.push(value);
        }
      } else if (_.indexOf(result, value) < 0) {
        result.push(value);
      }
    }
    return result;
  };

  // Produce an array that contains the union: each distinct element from all of
  // the passed-in arrays.
  _.union = function() {
    return _.uniq(flatten(arguments, true, true, []));
  };

  // Produce an array that contains every item shared between all the
  // passed-in arrays.
  _.intersection = function(array) {
    if (array == null) return [];
    var result = [];
    var argsLength = arguments.length;
    for (var i = 0, length = array.length; i < length; i++) {
      var item = array[i];
      if (_.contains(result, item)) continue;
      for (var j = 1; j < argsLength; j++) {
        if (!_.contains(arguments[j], item)) break;
      }
      if (j === argsLength) result.push(item);
    }
    return result;
  };

  // Take the difference between one array and a number of other arrays.
  // Only the elements present in just the first array will remain.
  _.difference = function(array) {
    var rest = flatten(slice.call(arguments, 1), true, true, []);
    return _.filter(array, function(value){
      return !_.contains(rest, value);
    });
  };

  // Zip together multiple lists into a single array -- elements that share
  // an index go together.
  _.zip = function(array) {
    if (array == null) return [];
    var length = _.max(arguments, 'length').length;
    var results = Array(length);
    for (var i = 0; i < length; i++) {
      results[i] = _.pluck(arguments, i);
    }
    return results;
  };

  // Converts lists into objects. Pass either a single array of `[key, value]`
  // pairs, or two parallel arrays of the same length -- one of keys, and one of
  // the corresponding values.
  _.object = function(list, values) {
    if (list == null) return {};
    var result = {};
    for (var i = 0, length = list.length; i < length; i++) {
      if (values) {
        result[list[i]] = values[i];
      } else {
        result[list[i][0]] = list[i][1];
      }
    }
    return result;
  };

  // Return the position of the first occurrence of an item in an array,
  // or -1 if the item is not included in the array.
  // If the array is large and already in sort order, pass `true`
  // for **isSorted** to use binary search.
  _.indexOf = function(array, item, isSorted) {
    if (array == null) return -1;
    var i = 0, length = array.length;
    if (isSorted) {
      if (typeof isSorted == 'number') {
        i = isSorted < 0 ? Math.max(0, length + isSorted) : isSorted;
      } else {
        i = _.sortedIndex(array, item);
        return array[i] === item ? i : -1;
      }
    }
    for (; i < length; i++) if (array[i] === item) return i;
    return -1;
  };

  _.lastIndexOf = function(array, item, from) {
    if (array == null) return -1;
    var idx = array.length;
    if (typeof from == 'number') {
      idx = from < 0 ? idx + from + 1 : Math.min(idx, from + 1);
    }
    while (--idx >= 0) if (array[idx] === item) return idx;
    return -1;
  };

  // Generate an integer Array containing an arithmetic progression. A port of
  // the native Python `range()` function. See
  // [the Python documentation](http://docs.python.org/library/functions.html#range).
  _.range = function(start, stop, step) {
    if (arguments.length <= 1) {
      stop = start || 0;
      start = 0;
    }
    step = step || 1;

    var length = Math.max(Math.ceil((stop - start) / step), 0);
    var range = Array(length);

    for (var idx = 0; idx < length; idx++, start += step) {
      range[idx] = start;
    }

    return range;
  };

  // Function (ahem) Functions
  // ------------------

  // Reusable constructor function for prototype setting.
  var Ctor = function(){};

  // Create a function bound to a given object (assigning `this`, and arguments,
  // optionally). Delegates to **ECMAScript 5**'s native `Function.bind` if
  // available.
  _.bind = function(func, context) {
    var args, bound;
    if (nativeBind && func.bind === nativeBind) return nativeBind.apply(func, slice.call(arguments, 1));
    if (!_.isFunction(func)) throw new TypeError('Bind must be called on a function');
    args = slice.call(arguments, 2);
    bound = function() {
      if (!(this instanceof bound)) return func.apply(context, args.concat(slice.call(arguments)));
      Ctor.prototype = func.prototype;
      var self = new Ctor;
      Ctor.prototype = null;
      var result = func.apply(self, args.concat(slice.call(arguments)));
      if (_.isObject(result)) return result;
      return self;
    };
    return bound;
  };

  // Partially apply a function by creating a version that has had some of its
  // arguments pre-filled, without changing its dynamic `this` context. _ acts
  // as a placeholder, allowing any combination of arguments to be pre-filled.
  _.partial = function(func) {
    var boundArgs = slice.call(arguments, 1);
    return function() {
      var position = 0;
      var args = boundArgs.slice();
      for (var i = 0, length = args.length; i < length; i++) {
        if (args[i] === _) args[i] = arguments[position++];
      }
      while (position < arguments.length) args.push(arguments[position++]);
      return func.apply(this, args);
    };
  };

  // Bind a number of an object's methods to that object. Remaining arguments
  // are the method names to be bound. Useful for ensuring that all callbacks
  // defined on an object belong to it.
  _.bindAll = function(obj) {
    var i, length = arguments.length, key;
    if (length <= 1) throw new Error('bindAll must be passed function names');
    for (i = 1; i < length; i++) {
      key = arguments[i];
      obj[key] = _.bind(obj[key], obj);
    }
    return obj;
  };

  // Memoize an expensive function by storing its results.
  _.memoize = function(func, hasher) {
    var memoize = function(key) {
      var cache = memoize.cache;
      var address = hasher ? hasher.apply(this, arguments) : key;
      if (!_.has(cache, address)) cache[address] = func.apply(this, arguments);
      return cache[address];
    };
    memoize.cache = {};
    return memoize;
  };

  // Delays a function for the given number of milliseconds, and then calls
  // it with the arguments supplied.
  _.delay = function(func, wait) {
    var args = slice.call(arguments, 2);
    return setTimeout(function(){
      return func.apply(null, args);
    }, wait);
  };

  // Defers a function, scheduling it to run after the current call stack has
  // cleared.
  _.defer = function(func) {
    return _.delay.apply(_, [func, 1].concat(slice.call(arguments, 1)));
  };

  // Returns a function, that, when invoked, will only be triggered at most once
  // during a given window of time. Normally, the throttled function will run
  // as much as it can, without ever going more than once per `wait` duration;
  // but if you'd like to disable the execution on the leading edge, pass
  // `{leading: false}`. To disable execution on the trailing edge, ditto.
  _.throttle = function(func, wait, options) {
    var context, args, result;
    var timeout = null;
    var previous = 0;
    if (!options) options = {};
    var later = function() {
      previous = options.leading === false ? 0 : _.now();
      timeout = null;
      result = func.apply(context, args);
      if (!timeout) context = args = null;
    };
    return function() {
      var now = _.now();
      if (!previous && options.leading === false) previous = now;
      var remaining = wait - (now - previous);
      context = this;
      args = arguments;
      if (remaining <= 0 || remaining > wait) {
        clearTimeout(timeout);
        timeout = null;
        previous = now;
        result = func.apply(context, args);
        if (!timeout) context = args = null;
      } else if (!timeout && options.trailing !== false) {
        timeout = setTimeout(later, remaining);
      }
      return result;
    };
  };

  // Returns a function, that, as long as it continues to be invoked, will not
  // be triggered. The function will be called after it stops being called for
  // N milliseconds. If `immediate` is passed, trigger the function on the
  // leading edge, instead of the trailing.
  _.debounce = function(func, wait, immediate) {
    var timeout, args, context, timestamp, result;

    var later = function() {
      var last = _.now() - timestamp;

      if (last < wait && last > 0) {
        timeout = setTimeout(later, wait - last);
      } else {
        timeout = null;
        if (!immediate) {
          result = func.apply(context, args);
          if (!timeout) context = args = null;
        }
      }
    };

    return function() {
      context = this;
      args = arguments;
      timestamp = _.now();
      var callNow = immediate && !timeout;
      if (!timeout) timeout = setTimeout(later, wait);
      if (callNow) {
        result = func.apply(context, args);
        context = args = null;
      }

      return result;
    };
  };

  // Returns the first function passed as an argument to the second,
  // allowing you to adjust arguments, run code before and after, and
  // conditionally execute the original function.
  _.wrap = function(func, wrapper) {
    return _.partial(wrapper, func);
  };

  // Returns a negated version of the passed-in predicate.
  _.negate = function(predicate) {
    return function() {
      return !predicate.apply(this, arguments);
    };
  };

  // Returns a function that is the composition of a list of functions, each
  // consuming the return value of the function that follows.
  _.compose = function() {
    var args = arguments;
    var start = args.length - 1;
    return function() {
      var i = start;
      var result = args[start].apply(this, arguments);
      while (i--) result = args[i].call(this, result);
      return result;
    };
  };

  // Returns a function that will only be executed after being called N times.
  _.after = function(times, func) {
    return function() {
      if (--times < 1) {
        return func.apply(this, arguments);
      }
    };
  };

  // Returns a function that will only be executed before being called N times.
  _.before = function(times, func) {
    var memo;
    return function() {
      if (--times > 0) {
        memo = func.apply(this, arguments);
      } else {
        func = null;
      }
      return memo;
    };
  };

  // Returns a function that will be executed at most one time, no matter how
  // often you call it. Useful for lazy initialization.
  _.once = _.partial(_.before, 2);

  // Object Functions
  // ----------------

  // Retrieve the names of an object's properties.
  // Delegates to **ECMAScript 5**'s native `Object.keys`
  _.keys = function(obj) {
    if (!_.isObject(obj)) return [];
    if (nativeKeys) return nativeKeys(obj);
    var keys = [];
    for (var key in obj) if (_.has(obj, key)) keys.push(key);
    return keys;
  };

  // Retrieve the values of an object's properties.
  _.values = function(obj) {
    var keys = _.keys(obj);
    var length = keys.length;
    var values = Array(length);
    for (var i = 0; i < length; i++) {
      values[i] = obj[keys[i]];
    }
    return values;
  };

  // Convert an object into a list of `[key, value]` pairs.
  _.pairs = function(obj) {
    var keys = _.keys(obj);
    var length = keys.length;
    var pairs = Array(length);
    for (var i = 0; i < length; i++) {
      pairs[i] = [keys[i], obj[keys[i]]];
    }
    return pairs;
  };

  // Invert the keys and values of an object. The values must be serializable.
  _.invert = function(obj) {
    var result = {};
    var keys = _.keys(obj);
    for (var i = 0, length = keys.length; i < length; i++) {
      result[obj[keys[i]]] = keys[i];
    }
    return result;
  };

  // Return a sorted list of the function names available on the object.
  // Aliased as `methods`
  _.functions = _.methods = function(obj) {
    var names = [];
    for (var key in obj) {
      if (_.isFunction(obj[key])) names.push(key);
    }
    return names.sort();
  };

  // Extend a given object with all the properties in passed-in object(s).
  _.extend = function(obj) {
    if (!_.isObject(obj)) return obj;
    var source, prop;
    for (var i = 1, length = arguments.length; i < length; i++) {
      source = arguments[i];
      for (prop in source) {
        if (hasOwnProperty.call(source, prop)) {
            obj[prop] = source[prop];
        }
      }
    }
    return obj;
  };

  // Return a copy of the object only containing the whitelisted properties.
  _.pick = function(obj, iteratee, context) {
    var result = {}, key;
    if (obj == null) return result;
    if (_.isFunction(iteratee)) {
      iteratee = createCallback(iteratee, context);
      for (key in obj) {
        var value = obj[key];
        if (iteratee(value, key, obj)) result[key] = value;
      }
    } else {
      var keys = concat.apply([], slice.call(arguments, 1));
      obj = new Object(obj);
      for (var i = 0, length = keys.length; i < length; i++) {
        key = keys[i];
        if (key in obj) result[key] = obj[key];
      }
    }
    return result;
  };

   // Return a copy of the object without the blacklisted properties.
  _.omit = function(obj, iteratee, context) {
    if (_.isFunction(iteratee)) {
      iteratee = _.negate(iteratee);
    } else {
      var keys = _.map(concat.apply([], slice.call(arguments, 1)), String);
      iteratee = function(value, key) {
        return !_.contains(keys, key);
      };
    }
    return _.pick(obj, iteratee, context);
  };

  // Fill in a given object with default properties.
  _.defaults = function(obj) {
    if (!_.isObject(obj)) return obj;
    for (var i = 1, length = arguments.length; i < length; i++) {
      var source = arguments[i];
      for (var prop in source) {
        if (obj[prop] === void 0) obj[prop] = source[prop];
      }
    }
    return obj;
  };

  // Create a (shallow-cloned) duplicate of an object.
  _.clone = function(obj) {
    if (!_.isObject(obj)) return obj;
    return _.isArray(obj) ? obj.slice() : _.extend({}, obj);
  };

  // Invokes interceptor with the obj, and then returns obj.
  // The primary purpose of this method is to "tap into" a method chain, in
  // order to perform operations on intermediate results within the chain.
  _.tap = function(obj, interceptor) {
    interceptor(obj);
    return obj;
  };

  // Internal recursive comparison function for `isEqual`.
  var eq = function(a, b, aStack, bStack) {
    // Identical objects are equal. `0 === -0`, but they aren't identical.
    // See the [Harmony `egal` proposal](http://wiki.ecmascript.org/doku.php?id=harmony:egal).
    if (a === b) return a !== 0 || 1 / a === 1 / b;
    // A strict comparison is necessary because `null == undefined`.
    if (a == null || b == null) return a === b;
    // Unwrap any wrapped objects.
    if (a instanceof _) a = a._wrapped;
    if (b instanceof _) b = b._wrapped;
    // Compare `[[Class]]` names.
    var className = toString.call(a);
    if (className !== toString.call(b)) return false;
    switch (className) {
      // Strings, numbers, regular expressions, dates, and booleans are compared by value.
      case '[object RegExp]':
      // RegExps are coerced to strings for comparison (Note: '' + /a/i === '/a/i')
      case '[object String]':
        // Primitives and their corresponding object wrappers are equivalent; thus, `"5"` is
        // equivalent to `new String("5")`.
        return '' + a === '' + b;
      case '[object Number]':
        // `NaN`s are equivalent, but non-reflexive.
        // Object(NaN) is equivalent to NaN
        if (+a !== +a) return +b !== +b;
        // An `egal` comparison is performed for other numeric values.
        return +a === 0 ? 1 / +a === 1 / b : +a === +b;
      case '[object Date]':
      case '[object Boolean]':
        // Coerce dates and booleans to numeric primitive values. Dates are compared by their
        // millisecond representations. Note that invalid dates with millisecond representations
        // of `NaN` are not equivalent.
        return +a === +b;
    }
    if (typeof a != 'object' || typeof b != 'object') return false;
    // Assume equality for cyclic structures. The algorithm for detecting cyclic
    // structures is adapted from ES 5.1 section 15.12.3, abstract operation `JO`.
    var length = aStack.length;
    while (length--) {
      // Linear search. Performance is inversely proportional to the number of
      // unique nested structures.
      if (aStack[length] === a) return bStack[length] === b;
    }
    // Objects with different constructors are not equivalent, but `Object`s
    // from different frames are.
    var aCtor = a.constructor, bCtor = b.constructor;
    if (
      aCtor !== bCtor &&
      // Handle Object.create(x) cases
      'constructor' in a && 'constructor' in b &&
      !(_.isFunction(aCtor) && aCtor instanceof aCtor &&
        _.isFunction(bCtor) && bCtor instanceof bCtor)
    ) {
      return false;
    }
    // Add the first object to the stack of traversed objects.
    aStack.push(a);
    bStack.push(b);
    var size, result;
    // Recursively compare objects and arrays.
    if (className === '[object Array]') {
      // Compare array lengths to determine if a deep comparison is necessary.
      size = a.length;
      result = size === b.length;
      if (result) {
        // Deep compare the contents, ignoring non-numeric properties.
        while (size--) {
          if (!(result = eq(a[size], b[size], aStack, bStack))) break;
        }
      }
    } else {
      // Deep compare objects.
      var keys = _.keys(a), key;
      size = keys.length;
      // Ensure that both objects contain the same number of properties before comparing deep equality.
      result = _.keys(b).length === size;
      if (result) {
        while (size--) {
          // Deep compare each member
          key = keys[size];
          if (!(result = _.has(b, key) && eq(a[key], b[key], aStack, bStack))) break;
        }
      }
    }
    // Remove the first object from the stack of traversed objects.
    aStack.pop();
    bStack.pop();
    return result;
  };

  // Perform a deep comparison to check if two objects are equal.
  _.isEqual = function(a, b) {
    return eq(a, b, [], []);
  };

  // Is a given array, string, or object empty?
  // An "empty" object has no enumerable own-properties.
  _.isEmpty = function(obj) {
    if (obj == null) return true;
    if (_.isArray(obj) || _.isString(obj) || _.isArguments(obj)) return obj.length === 0;
    for (var key in obj) if (_.has(obj, key)) return false;
    return true;
  };

  // Is a given value a DOM element?
  _.isElement = function(obj) {
    return !!(obj && obj.nodeType === 1);
  };

  // Is a given value an array?
  // Delegates to ECMA5's native Array.isArray
  _.isArray = nativeIsArray || function(obj) {
    return toString.call(obj) === '[object Array]';
  };

  // Is a given variable an object?
  _.isObject = function(obj) {
    var type = typeof obj;
    return type === 'function' || type === 'object' && !!obj;
  };

  // Add some isType methods: isArguments, isFunction, isString, isNumber, isDate, isRegExp.
  _.each(['Arguments', 'Function', 'String', 'Number', 'Date', 'RegExp'], function(name) {
    _['is' + name] = function(obj) {
      return toString.call(obj) === '[object ' + name + ']';
    };
  });

  // Define a fallback version of the method in browsers (ahem, IE), where
  // there isn't any inspectable "Arguments" type.
  if (!_.isArguments(arguments)) {
    _.isArguments = function(obj) {
      return _.has(obj, 'callee');
    };
  }

  // Optimize `isFunction` if appropriate. Work around an IE 11 bug.
  if (typeof /./ !== 'function') {
    _.isFunction = function(obj) {
      return typeof obj == 'function' || false;
    };
  }

  // Is a given object a finite number?
  _.isFinite = function(obj) {
    return isFinite(obj) && !isNaN(parseFloat(obj));
  };

  // Is the given value `NaN`? (NaN is the only number which does not equal itself).
  _.isNaN = function(obj) {
    return _.isNumber(obj) && obj !== +obj;
  };

  // Is a given value a boolean?
  _.isBoolean = function(obj) {
    return obj === true || obj === false || toString.call(obj) === '[object Boolean]';
  };

  // Is a given value equal to null?
  _.isNull = function(obj) {
    return obj === null;
  };

  // Is a given variable undefined?
  _.isUndefined = function(obj) {
    return obj === void 0;
  };

  // Shortcut function for checking if an object has a given property directly
  // on itself (in other words, not on a prototype).
  _.has = function(obj, key) {
    return obj != null && hasOwnProperty.call(obj, key);
  };

  // Utility Functions
  // -----------------

  // Run Underscore.js in *noConflict* mode, returning the `_` variable to its
  // previous owner. Returns a reference to the Underscore object.
  _.noConflict = function() {
    root._ = previousUnderscore;
    return this;
  };

  // Keep the identity function around for default iteratees.
  _.identity = function(value) {
    return value;
  };

  _.constant = function(value) {
    return function() {
      return value;
    };
  };

  _.noop = function(){};

  _.property = function(key) {
    return function(obj) {
      return obj[key];
    };
  };

  // Returns a predicate for checking whether an object has a given set of `key:value` pairs.
  _.matches = function(attrs) {
    var pairs = _.pairs(attrs), length = pairs.length;
    return function(obj) {
      if (obj == null) return !length;
      obj = new Object(obj);
      for (var i = 0; i < length; i++) {
        var pair = pairs[i], key = pair[0];
        if (pair[1] !== obj[key] || !(key in obj)) return false;
      }
      return true;
    };
  };

  // Run a function **n** times.
  _.times = function(n, iteratee, context) {
    var accum = Array(Math.max(0, n));
    iteratee = createCallback(iteratee, context, 1);
    for (var i = 0; i < n; i++) accum[i] = iteratee(i);
    return accum;
  };

  // Return a random integer between min and max (inclusive).
  _.random = function(min, max) {
    if (max == null) {
      max = min;
      min = 0;
    }
    return min + Math.floor(Math.random() * (max - min + 1));
  };

  // A (possibly faster) way to get the current timestamp as an integer.
  _.now = Date.now || function() {
    return new Date().getTime();
  };

   // List of HTML entities for escaping.
  var escapeMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '`': '&#x60;'
  };
  var unescapeMap = _.invert(escapeMap);

  // Functions for escaping and unescaping strings to/from HTML interpolation.
  var createEscaper = function(map) {
    var escaper = function(match) {
      return map[match];
    };
    // Regexes for identifying a key that needs to be escaped
    var source = '(?:' + _.keys(map).join('|') + ')';
    var testRegexp = RegExp(source);
    var replaceRegexp = RegExp(source, 'g');
    return function(string) {
      string = string == null ? '' : '' + string;
      return testRegexp.test(string) ? string.replace(replaceRegexp, escaper) : string;
    };
  };
  _.escape = createEscaper(escapeMap);
  _.unescape = createEscaper(unescapeMap);

  // If the value of the named `property` is a function then invoke it with the
  // `object` as context; otherwise, return it.
  _.result = function(object, property) {
    if (object == null) return void 0;
    var value = object[property];
    return _.isFunction(value) ? object[property]() : value;
  };

  // Generate a unique integer id (unique within the entire client session).
  // Useful for temporary DOM ids.
  var idCounter = 0;
  _.uniqueId = function(prefix) {
    var id = ++idCounter + '';
    return prefix ? prefix + id : id;
  };

  // By default, Underscore uses ERB-style template delimiters, change the
  // following template settings to use alternative delimiters.
  _.templateSettings = {
    evaluate    : /<%([\s\S]+?)%>/g,
    interpolate : /<%=([\s\S]+?)%>/g,
    escape      : /<%-([\s\S]+?)%>/g
  };

  // When customizing `templateSettings`, if you don't want to define an
  // interpolation, evaluation or escaping regex, we need one that is
  // guaranteed not to match.
  var noMatch = /(.)^/;

  // Certain characters need to be escaped so that they can be put into a
  // string literal.
  var escapes = {
    "'":      "'",
    '\\':     '\\',
    '\r':     'r',
    '\n':     'n',
    '\u2028': 'u2028',
    '\u2029': 'u2029'
  };

  var escaper = /\\|'|\r|\n|\u2028|\u2029/g;

  var escapeChar = function(match) {
    return '\\' + escapes[match];
  };

  // JavaScript micro-templating, similar to John Resig's implementation.
  // Underscore templating handles arbitrary delimiters, preserves whitespace,
  // and correctly escapes quotes within interpolated code.
  // NB: `oldSettings` only exists for backwards compatibility.
  _.template = function(text, settings, oldSettings) {
    if (!settings && oldSettings) settings = oldSettings;
    settings = _.defaults({}, settings, _.templateSettings);

    // Combine delimiters into one regular expression via alternation.
    var matcher = RegExp([
      (settings.escape || noMatch).source,
      (settings.interpolate || noMatch).source,
      (settings.evaluate || noMatch).source
    ].join('|') + '|$', 'g');

    // Compile the template source, escaping string literals appropriately.
    var index = 0;
    var source = "__p+='";
    text.replace(matcher, function(match, escape, interpolate, evaluate, offset) {
      source += text.slice(index, offset).replace(escaper, escapeChar);
      index = offset + match.length;

      if (escape) {
        source += "'+\n((__t=(" + escape + "))==null?'':_.escape(__t))+\n'";
      } else if (interpolate) {
        source += "'+\n((__t=(" + interpolate + "))==null?'':__t)+\n'";
      } else if (evaluate) {
        source += "';\n" + evaluate + "\n__p+='";
      }

      // Adobe VMs need the match returned to produce the correct offest.
      return match;
    });
    source += "';\n";

    // If a variable is not specified, place data values in local scope.
    if (!settings.variable) source = 'with(obj||{}){\n' + source + '}\n';

    source = "var __t,__p='',__j=Array.prototype.join," +
      "print=function(){__p+=__j.call(arguments,'');};\n" +
      source + 'return __p;\n';

    try {
      var render = new Function(settings.variable || 'obj', '_', source);
    } catch (e) {
      e.source = source;
      throw e;
    }

    var template = function(data) {
      return render.call(this, data, _);
    };

    // Provide the compiled source as a convenience for precompilation.
    var argument = settings.variable || 'obj';
    template.source = 'function(' + argument + '){\n' + source + '}';

    return template;
  };

  // Add a "chain" function. Start chaining a wrapped Underscore object.
  _.chain = function(obj) {
    var instance = _(obj);
    instance._chain = true;
    return instance;
  };

  // OOP
  // ---------------
  // If Underscore is called as a function, it returns a wrapped object that
  // can be used OO-style. This wrapper holds altered versions of all the
  // underscore functions. Wrapped objects may be chained.

  // Helper function to continue chaining intermediate results.
  var result = function(obj) {
    return this._chain ? _(obj).chain() : obj;
  };

  // Add your own custom functions to the Underscore object.
  _.mixin = function(obj) {
    _.each(_.functions(obj), function(name) {
      var func = _[name] = obj[name];
      _.prototype[name] = function() {
        var args = [this._wrapped];
        push.apply(args, arguments);
        return result.call(this, func.apply(_, args));
      };
    });
  };

  // Add all of the Underscore functions to the wrapper object.
  _.mixin(_);

  // Add all mutator Array functions to the wrapper.
  _.each(['pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift'], function(name) {
    var method = ArrayProto[name];
    _.prototype[name] = function() {
      var obj = this._wrapped;
      method.apply(obj, arguments);
      if ((name === 'shift' || name === 'splice') && obj.length === 0) delete obj[0];
      return result.call(this, obj);
    };
  });

  // Add all accessor Array functions to the wrapper.
  _.each(['concat', 'join', 'slice'], function(name) {
    var method = ArrayProto[name];
    _.prototype[name] = function() {
      return result.call(this, method.apply(this._wrapped, arguments));
    };
  });

  // Extracts the result from a wrapped and chained object.
  _.prototype.value = function() {
    return this._wrapped;
  };

  // AMD registration happens at the end for compatibility with AMD loaders
  // that may not enforce next-turn semantics on modules. Even though general
  // practice for AMD registration is to be anonymous, underscore registers
  // as a named module because, like jQuery, it is a base library that is
  // popular enough to be bundled in a third party lib, but not be part of
  // an AMD load request. Those cases could generate an error when an
  // anonymous define() is called outside of a loader request.
  if (typeof define === 'function' && define.amd) {
    define('underscore', [], function() {
      return _;
    });
  }
}.call(this));

}).call(this,require("1YiZ5S"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../node_modules/underscore/underscore.js","/../node_modules/underscore")
},{"1YiZ5S":4,"buffer":1}],7:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var THREE = require('three-vr');
var _ = require('underscore');

var timeline;

/***********************************************************
* Function definitions first, app initialisation at line 395
************************************************************/
function createControls(camera, scene) {
  var controlObj = new THREE.Object3D();
  var voiceMaterial = new THREE.MeshLambertMaterial({
    map: THREE.ImageUtils.loadTexture("../files/micro1.jpg"),
  });
  var backMaterial = new THREE.MeshLambertMaterial({
    map: THREE.ImageUtils.loadTexture("../files/back28.png")
  });
  var homeMaterial = new THREE.MeshLambertMaterial({
    map: THREE.ImageUtils.loadTexture("../files/soundcloud.png")
  });
  var voice = new THREE.Mesh(new THREE.CircleGeometry(12, 45), voiceMaterial);
  var back = new THREE.Mesh(new THREE.CircleGeometry(12, 45), backMaterial);
  var home = new THREE.Mesh(new THREE.CircleGeometry(12, 45), homeMaterial);

  voice.translateX(75 * Math.cos(Math.PI / 3));
  voice.translateZ(75 * Math.sin(Math.PI / 3));
  voice.translateY(-100);
  voice.lookAt(camera.position);

  back.translateX(75 * Math.cos(-Math.PI / 3));
  back.translateZ(75 * Math.sin(-Math.PI / 3));
  back.translateY(-100);
  back.lookAt(camera.position);

  home.translateX(75 * Math.cos(0));
  home.translateZ(75 * Math.sin(0));
  home.translateY(-100);

  home.lookAt(camera.position);

  controlObj.add(voice);
  controlObj.add(back);
  controlObj.add(home);
  controlObj.position = new THREE.Vector3(0, 0, 0);
  scene.add(controlObj);
}

function createNavigation(camera, scene) {
  var controlObj = new THREE.Object3D();
  timeline = new THREE.Mesh(new THREE.PlaneGeometry(593, 140),
    new THREE.MeshLambertMaterial({
      map: THREE.ImageUtils.loadTexture("../files/trees-remix.png"),
      transparent: true,
      opacity: 0
    })
    );

  timeline.translateX(100 * Math.cos(0));
  timeline.translateY(320);
  timeline.translateZ(100 * Math.sin(0));
  timeline.lookAt(camera.position);
  timeline.rotateX(-Math.PI/12);

  controlObj.add(timeline);
  controlObj.position = new THREE.Vector3(0,0,0);
  scene.add(controlObj);
}


/**
* Generates 3d interface
*/
function createApp(tracksArray) {
  var camera;
  var renderer;
  var trackPlaying;

  renderer = new THREE.WebGLRenderer({
    precision: "mediump",
    devicePixelRatio: 1.5,
    antialias: true
  });
  renderer.setSize(window.innerWidth, window.innerHeight);

  var element = renderer.domElement;
  var container = document.getElementById('app');
  container.appendChild(element);

  //Mostly Three elements
  var effect = new THREE.StereoEffect(renderer);
  var scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(90, (window.innerWidth) / window.innerHeight, 0.001, 1000);
  camera.position.set(0, 0, 0);
  camera.lookAt(new THREE.Vector3(0.0, 0.0, 0.0));
  scene.add(camera);
  var ambientLight = new THREE.AmbientLight(0xbbbbbb);
  scene.add(ambientLight);

  var domEvents = new THREEx.DomEvents(camera, element);

  controls = new THREE.OrbitControls(camera, element);
  controls.rotateUp(Math.PI / 4);
  controls.target.set(
    camera.position.x + 0.1,
    camera.position.y,
    camera.position.z
    );
  controls.noZoom = false;
  controls.noPan = true;

  var clock = new THREE.Clock();
  
  window.addEventListener('deviceorientation', setOrientationControls, true);
  window.addEventListener('resize', resize, false);
  setTimeout(resize, 1);

  function setOrientationControls(e) {
    if (!e.alpha) {
      return;
    }

    controls = new THREE.DeviceOrientationControls(camera, true);
    controls.connect();
    controls.update();

    element.addEventListener('click', fullscreen, false);

    window.removeEventListener('deviceorientation', setOrientationControls);
  }  

  function resize() {
    var width = container.offsetWidth;
    var height = container.offsetHeight;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.setSize(width, height);
    effect.setSize(width, height);
  }

  function update(dt) {
    resize();
    camera.updateProjectionMatrix();
    controls.update(dt);
  }

  function render(dt) {
    effect.render(scene, camera);
  }

  function animate() {
    update(clock.getDelta());
    render(clock.getDelta());

    requestAnimationFrame(function() {
      animate();
    });
  }

  function fillTrackRing(obj, tracksArray, cubes, yPos) {
    for (i = 0.0; i <= (Math.PI * 2); i += Math.PI / 6) {
      if (!tracksArray.length)
        return;

      var track = tracksArray.pop();
      var material;

      if (track.artwork_url) {
        material = new THREE.MeshLambertMaterial({
          map: THREE.ImageUtils.loadTexture(track.artwork_url)
        });
      } else {
        material = new THREE.MeshLambertMaterial({
          map: THREE.ImageUtils.loadTexture("../files/soundcloud.png")
        });
      }

      var cube = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), material);
      var play = new THREE.Mesh(new THREE.PlaneGeometry(50, 50),
        new THREE.MeshLambertMaterial({
          map: THREE.ImageUtils.loadTexture("../files/play102.png"),
          transparent: true,
          opacity: 0
        }));

      var pause = new THREE.Mesh(new THREE.PlaneGeometry(50, 50),
        new THREE.MeshLambertMaterial({
          map: THREE.ImageUtils.loadTexture("../files/pause31.png"),
          transparent: true,
          opacity: 0
        }));

      cube.overdraw = true;
      obj.add(pause);
      obj.add(play);
      obj.add(cube);

      cube.translateZ(200 * Math.sin(i));
      cube.translateX(200 * Math.cos(i));
      cube.translateY(yPos);

      play.translateZ(190 * Math.sin(i));
      play.translateX(190 * Math.cos(i));
      play.translateY(yPos);

      pause.translateZ(190 * Math.sin(i));
      pause.translateX(190 * Math.cos(i));
      pause.translateY(yPos);

      cube.lookAt(camera.position);
      play.lookAt(camera.position);
      pause.lookAt(camera.position);

      cube.playButton = play;
      cube.pauseButton = pause;

      cube.uri = track.uri;
      cubes.push(cube);
    }
  }

  function createDome(tracksArray) {
    var obj = new THREE.Object3D();
    var cubes = new Array();
    
    fillTrackRing(obj, tracksArray, cubes, 0);
    fillTrackRing(obj, tracksArray, cubes, 110);
    fillTrackRing(obj, tracksArray, cubes, -110);

    obj.position = new THREE.Vector3(0, 0, 0);
    scene.add(obj);

    var currentIndex;
    var currentSound;
    var isPlaying = false;
    _.each(cubes, function (cube) {
      domEvents.addEventListener(cube, 'click', function(event) {
        var index = cubes.indexOf(cube);
        var current = cubes[index - 2];

        if (cubes.indexOf(cube) !== currentIndex) {
          console.log('Stop all');
          console.log('');
          SC.streamStopAll();
        }

        SC.stream(current.uri, function(sound) {

          if (isPlaying && cubes.indexOf(cube) == currentIndex) {
            currentSound.pause();
            console.log('isCube');
            console.log();
            isPlaying = false;
            trackPlaying = '';
            cubes[cubes.indexOf(cube) + 2].playButton.material.opacity = 1;
            cubes[cubes.indexOf(cube) + 2].pauseButton.material.opacity = 0;
            timeline.material.opacity = 0;
          } else {
            currentSound = sound;
            sound.play();
            isPlaying = true;
            currentIndex = cubes.indexOf(cube);
            console.log('Play this');
            console.log('');
            trackPlaying = current.uri;
            cubes[cubes.indexOf(cube) + 2].playButton.material.opacity = 0;
            cubes[cubes.indexOf(cube) + 2].pauseButton.material.opacity = 1;
            timeline.material.opacity = 1;
          }
        });
      });
      domEvents.addEventListener(cube, 'mouseover', function(event) {
        var index = cubes.indexOf(cube);
        if (index !== currentIndex)
          cubes[index + 2].playButton.material.opacity = 1;
        else {
          if(isPlaying)
            cubes[index + 2].pauseButton.material.opacity = 1;
          else
            cubes[index + 2].playButton.material.opacity = 1;
        }
      }, false);
  
      domEvents.addEventListener(cube, 'mouseout', function(event) {
        var index = cubes.indexOf(cube);
        var current = cubes[index - 2];
        cubes[index + 2].playButton.material.opacity = 0;
        cubes[index + 2].pauseButton.material.opacity = 0;
      }, false);

    }); 
  } 

  animate();
  createDome(tracksArray);
  createControls(camera, scene);
  createNavigation(camera, scene);
}

/*****
* Main
******/
document.addEventListener("DOMContentLoaded", function() {
  var url = document.URL.replace(/%20/gi, ' ').split('/');
  console.log(url);
  var query = url[3];

  SC.initialize({
    client_id: 'c1da0911d3af90cfd3153d5c6d030137'
  });

  THREE.ImageUtils.crossOrigin = '';

  //MAIN
  SC.get('/tracks', {
    q: 'ghostly'
  }, function(tracks) {
    createApp(tracks);
  });
});
}).call(this,require("1YiZ5S"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/fake_db0e7f52.js","/")
},{"1YiZ5S":4,"buffer":1,"three-vr":5,"underscore":6}]},{},[7])