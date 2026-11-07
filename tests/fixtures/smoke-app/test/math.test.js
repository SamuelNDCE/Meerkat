import { test } from 'node:test'
import assert from 'node:assert/strict'
import { add, double } from '../src/math.js'

test('add', () => assert.equal(add(1, 2), 3))
test('double', () => assert.equal(double(4), 8))
