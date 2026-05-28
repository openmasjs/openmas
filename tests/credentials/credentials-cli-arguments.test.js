import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommandLineArguments } from '../../bin/credentials.js';

test('parseCommandLineArguments reads the subcommand', () => {
  const result = parseCommandLineArguments(['node', 'bin/credentials.js', 'edit']);

  assert.equal(result.subcommand, 'edit');
  assert.equal(result.environment, null);
});

test('parseCommandLineArguments reads --environment value', () => {
  const result = parseCommandLineArguments([
    'node',
    'bin/credentials.js',
    'edit',
    '--environment',
    'development',
  ]);

  assert.equal(result.subcommand, 'edit');
  assert.equal(result.environment, 'development');
});

test('parseCommandLineArguments reads --environment=value', () => {
  const result = parseCommandLineArguments([
    'node',
    'bin/credentials.js',
    'show',
    '--environment=staging',
  ]);

  assert.equal(result.subcommand, 'show');
  assert.equal(result.environment, 'staging');
});

test('parseCommandLineArguments reads a positional environment shorthand', () => {
  const result = parseCommandLineArguments([
    'node',
    'bin/credentials.js',
    'edit',
    'development',
  ]);

  assert.equal(result.subcommand, 'edit');
  assert.equal(result.environment, 'development');
});

test('parseCommandLineArguments lets explicit environment override positional shorthand', () => {
  const result = parseCommandLineArguments([
    'node',
    'bin/credentials.js',
    'edit',
    'development',
    '--environment',
    'production',
  ]);

  assert.equal(result.subcommand, 'edit');
  assert.equal(result.environment, 'production');
});
