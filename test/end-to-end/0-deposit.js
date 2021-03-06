/**
 * End To End tests using tomochain testnet deployed smart-contract,
 * change config in ./test/config.json ./test/config.json
 */

import chai from 'chai';
import TestConfig from '../config.json';
import * as TestUtils from '../utils';
import Commitment from '../../src/commitment';
import UTXO from '../../src/utxo';

const { expect } = chai;
chai.should();

const { WALLETS } = TestConfig;
const SENDER_WALLET = WALLETS[0]; // hold around 1 mil tomo

const amount = 2000000000000000000; // 1tomo
const TX_VALUE = '199900000'; // privacy protocol use 1e8 as unit
const trimPrefix = (str, char) => {
    char = char || '0';
    str.replace(new RegExp(`^${char}+`), '');
};

describe('#ete #deposit', () => {
    for (let count = 0; count < 20; count++) {
        // eslint-disable-next-line no-loop-func
        it('Successful deposit to to privacy account', (done) => {
            TestUtils.deposit(amount, SENDER_WALLET.privateKey, SENDER_WALLET.address).then((result) => {
                const returnedValue = result.utxo;
                const { proof } = result;

                const utxoIns = new UTXO(returnedValue);

                const isMineUTXO = utxoIns.checkOwnership(SENDER_WALLET.privateKey);

                // make sure SC doesn't change anything
                expect(
                    trimPrefix(proof.encryptedAmount),
                ).to.equal(
                    trimPrefix(utxoIns.amount),
                );
                expect(isMineUTXO).to.not.equal(null);
                expect(
                    trimPrefix(isMineUTXO.amount),
                ).to.equal(
                    trimPrefix(TX_VALUE),
                );

                // make sure decoded mask = generated mask
                expect(
                    trimPrefix(utxoIns.mask),
                ).to.equal(
                    trimPrefix(proof.encryptedMask),
                );
                expect(
                    trimPrefix(isMineUTXO.mask),
                ).to.equal(
                    trimPrefix(proof.mask),
                );

                // validate return commitment from amount,mask -
                expect(
                    Commitment.verifyCommitment(
                        TX_VALUE,
                        proof.mask,
                        {
                            X: utxoIns.commitmentX,
                            YBit: utxoIns.commitmentYBit,
                        },
                    ),
                ).to.equal(true);

                const expectedCommitment = Commitment.genCommitment(TX_VALUE.toString(), proof.mask).toString('hex');

                expect(
                    utxoIns.lfCommitment.encode('hex', true) === expectedCommitment,
                ).to.equal(true);
                done();
            }).catch((err) => {
                done(err);
            });

        });
    }

    for (let count = 0; count < 10; count++) {
        it('Successful deposit to create decoys', (done) => {
            const { privateKey, address } = WALLETS[2];
            TestUtils.deposit(1000000000000000000, privateKey, address).then(() => {
                done();
            })
                .catch((err) => {
                    done(err);
                });

        });
    }
});
