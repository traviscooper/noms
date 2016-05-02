// @flow

import {suite, test} from 'mocha';
import {makeTestingBatchStore} from './batch-store-adaptor.js';
import {emptyRef} from './ref.js';
import {assert} from 'chai';
import {default as DataStore, getDatasTypes, newCommit} from './data-store.js';
import {invariant, notNull} from './assert.js';
import {newMap} from './map.js';
import {stringType} from './type.js';
import {encodeNomsValue} from './encode.js';

suite('DataStore', () => {
  test('access', async () => {
    const bs = makeTestingBatchStore();
    const ds = new DataStore(bs);
    const input = 'abc';

    const c = encodeNomsValue(input, stringType);
    const v1 = await ds.readValue(c.ref);
    assert.equal(null, v1);

    bs.schedulePut(c, new Set());
    bs.flush();

    const v2 = await ds.readValue(c.ref);
    assert.equal('abc', v2);
  });

  test('commit', async () => {
    const bs = new makeTestingBatchStore();
    let ds = new DataStore(bs);
    const datasetID = 'ds1';

    const datasets = await ds.datasets();
    assert.isTrue(datasets.isEmpty());

    // |a|
    const aCommit = await newCommit('a');
    const ds2 = await ds.commit(datasetID, aCommit);

    // The old datastore still still has no head.
    assert.isNull(await ds.head(datasetID));

    // The new datastore has |a|.
    const aRef = notNull(await ds2.headRef(datasetID));
    assert.isTrue(aCommit.ref.equals(aRef.targetRef));
    const aCommit1 = notNull(await ds2.head(datasetID));
    assert.strictEqual('a', aCommit1.value);
    ds = ds2;

    // |a| <- |b|
    const bCommit = await newCommit('b', [aRef]);
    ds = await ds.commit(datasetID, bCommit);
    const bRef = notNull(await ds.headRef(datasetID));
    assert.isTrue(bCommit.ref.equals(bRef.targetRef));
    assert.strictEqual('b', notNull(await ds.head(datasetID)).value);

    // |a| <- |b|
    //   \----|c|
    // Should be disallowed.
    const cCommit = await newCommit('c');
    let message = '';
    try {
      await ds.commit(datasetID, cCommit);
      throw new Error('not reached');
    } catch (ex) {
      message = ex.message;
    }
    assert.strictEqual('Merge needed', message);
    assert.strictEqual('b', notNull(await ds.head(datasetID)).value);

    // |a| <- |b| <- |d|
    const dCommit = await newCommit('d', [bRef]);
    ds = await ds.commit(datasetID, dCommit);
    const dRef = notNull(await ds.headRef(datasetID));
    assert.isTrue(dCommit.ref.equals(dRef.targetRef));
    assert.strictEqual('d', notNull(await ds.head(datasetID)).value);

    // Attempt to recommit |b| with |a| as parent.
    // Should be disallowed.
    try {
      await ds.commit(datasetID, bCommit);
      throw new Error('not reached');
    } catch (ex) {
      message = ex.message;
    }
    // assert.strictEqual('Merge needed', message);
    assert.strictEqual('d', notNull(await ds.head(datasetID)).value);

    // Add a commit to a different datasetId
    ds = await ds.commit('otherDs', aCommit);
    assert.strictEqual('a', notNull(await ds.head('otherDs')).value);

    // Get a fresh datastore, and verify that both datasets are present
    const newDs = new DataStore(bs);
    assert.strictEqual('d', notNull(await newDs.head(datasetID)).value);
    assert.strictEqual('a', notNull(await newDs.head('otherDs')).value);
  });

  test('concurrency', async () => {
    const bs = new makeTestingBatchStore();
    let ds = new DataStore(bs);
    const datasetID = 'ds1';

    // |a|
    const aCommit = await newCommit('a');
    ds = await ds.commit(datasetID, aCommit);
    const aRef = notNull(await ds.headRef(datasetID));
    const bCommit = await newCommit('b', [aRef]);
    ds = await ds.commit(datasetID, bCommit);
    const bRef = notNull(await ds.headRef(datasetID));
    assert.strictEqual('b', notNull(await ds.head(datasetID)).value);

    // Important to create this here.
    let ds2 = new DataStore(bs);

    // Change 1:
    // |a| <- |b| <- |c|
    const cCommit = await newCommit('c', [bRef]);
    ds = await ds.commit(datasetID, cCommit);
    assert.strictEqual('c', notNull(await ds.head(datasetID)).value);

    // Change 2:
    // |a| <- |b| <- |e|
    // Should be disallowed, DataStore returned by Commit() should have |c| as Head.
    const eCommit = await newCommit('e', [bRef]);
    let message = '';
    try {
      ds2 = await ds2.commit(datasetID, eCommit);
      throw new Error('not reached');
    } catch (ex) {
      message = ex.message;
    }
    assert.strictEqual('Merge needed', message);
    assert.strictEqual('c', notNull(await ds.head(datasetID)).value);
  });


  test('empty datasets', async () => {
    const ds = new DataStore(makeTestingBatchStore());
    const datasets = await ds.datasets();
    assert.strictEqual(0, datasets.size);
  });

  test('head', async () => {
    const bs = new makeTestingBatchStore();
    let ds = new DataStore(bs);
    const types = getDatasTypes();

    const commit = await newCommit('foo', []);

    const commitRef = ds.writeValue(commit);
    const datasets = await newMap(['foo', commitRef], types.commitMapType);
    const rootRef = ds.writeValue(datasets).targetRef;
    assert.isTrue(await bs.updateRoot(rootRef, emptyRef));
    ds = new DataStore(bs); // refresh the datasets

    assert.strictEqual(1, datasets.size);
    const fooHead = await ds.head('foo');
    invariant(fooHead);
    assert.isTrue(fooHead.equals(commit));
    const barHead = await ds.head('bar');
    assert.isNull(barHead);
  });
});
