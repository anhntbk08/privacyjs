/* eslint-disable quote-props */
// @flow
import ecurve from 'ecurve';
import assert from 'assert';
import { generateKeys } from './address';
import Stealth from './stealth';
import { BigInteger } from './crypto';
import {
    numberToHex,
    bconcat,
    hextobin,
    bintohex,
    soliditySha3,
} from './common';

const ecparams = ecurve.getCurveByName('secp256k1');
const EC = require('elliptic').ec;

/**
 * TXO stands for the unspent output from bitcoin transactions.
 * Each transaction begins with coins used to balance the smart contrat.
 * UTXOs are processed continuously and are responsible for beginning and ending each transaction.
 * Confirmation of transaction results in the removal of spent coins from the UTXO smart-contract.
 * But a record of the spent coins still exists on the smart contrat.
 */

/* UTXO structure input
    * 0 - [commitmentX, pubkeyX, txPubX],
    * 1 - [commitmentYBit, pubkeyYBit, txPubYBit],
    * 2 - [EncryptedAmount, EncryptedMask],
    * 3 - _index
    *
*/

type UTXOType = {
    '0': {
        '0': string,
        '1': string,
        '2': string
    },
    '1': {
        '0': string,
        '1': string,
        '2': string
    },
    '2': {
        '0': string,
        '1': string
    },
    '3': number
}

// <Buffer 04 6d e2 f5 b6 19 8c e3 b4 fd 00 1a 99 7e d0 ba a5 e7 98 91 75 c1 19 56 7b be 59 05 f3 67 0b d7 24 8a df 1c c5 29 76 f8 de b6 19 f5 8f ac f5 ae c4 dc ... >,
type LongFormPoint = Buffer;

type Proof = {
    onetimeAddress: LongFormPoint,
    txPublicKey: LongFormPoint,
    encryptedAmount: string,
    mask: string,
    commitment: LongFormPoint,
    encryptedMask: string,
    index: number
}

class UTXO {
    commitmentX: string;

    commitmentYBit: string;

    pubkeyX: string;

    pubkeyYBit: string;

    amount: string;

    mask: string;

    txPubX: string;

    txPubYBit: string;

    index: number;

    lfStealth: ecurve.Point;

    lfTxPublicKey: ecurve.Point;

    lfCommitment: ecurve.Point;

    decodedAmount: string;

    decodedMask: string;

    privKey: string;

    /**
     *
     * @param {object} utxo
     * @param {privateKey} Optional
     */
    constructor(utxo: UTXOType) {
        this.commitmentX = utxo['0']['0'];
        this.commitmentYBit = utxo['1']['0'];
        this.pubkeyX = utxo['0']['1'];
        this.pubkeyYBit = utxo['1']['1'];
        this.amount = numberToHex(utxo['2'][0]);
        this.mask = numberToHex(utxo['2'][1]);
        this.txPubX = utxo['0']['2'];
        this.txPubYBit = utxo['1']['2'];
        this.index = utxo['3'];

        this.lfStealth = ecparams.pointFromX(parseInt(this.pubkeyYBit) % 2 === 1,
            BigInteger(this.pubkeyX));

        this.lfTxPublicKey = ecparams.pointFromX(parseInt(this.txPubYBit) % 2 === 1,
            BigInteger(this.txPubX));

        this.lfCommitment = ecparams.pointFromX(parseInt(this.commitmentYBit) % 2 === 1,
            BigInteger(this.commitmentX));
    }

    /**
     * Check if this utxo belong to account base on a secretkey
     * @param {string} privateSpendKey Hex string of private spend key - in other word serectkey
     * @returns {object} amount, keys
     */
    checkOwnership(privateSpendKey: string) {
        const receiver = new Stealth({
            ...generateKeys(privateSpendKey),
        });

        const decodedData = receiver.checkTransactionProof(
            this.lfTxPublicKey.getEncoded(false),
            this.lfStealth.getEncoded(false),
            this.amount,
            this.mask,
        );

        if (decodedData) {
            this.decodedAmount = decodedData.amount;
            this.decodedMask = decodedData.mask;
            this.privKey = decodedData.privKey;
        }

        return decodedData;
    }

    /**
     * Generate hash data as signing input to claim this utxo belongs to who owns privatekey
     * // TODO take note about the length of output
     * @param {string} targetAddress targetAddress who you're sending this utxo for
     * @returns {string} delegate data of utxo
     */
    getHashData(targetAddress: string) {
        return soliditySha3(
            bintohex(bconcat([
                this.lfCommitment.getEncoded(false),
                this.lfStealth.getEncoded(false),
                hextobin(targetAddress),
            ])),
        );
    }

    /**
     * create signature of an UTXO to send to smart-contract to withdraw
     * TODO: future we need to implement ring-signatureCT (monero-like) to prove
     * @param {string} privateKey
     * @results {ec.Signature} include the ec.Signature you can convert to anyform after that
     */
    sign(privateKey: string, targetAddress: string) {
        const secp256k1 = new EC('secp256k1');

        // Generate keys
        const key = secp256k1.keyFromPrivate(privateKey);

        const context = this.getHashData(targetAddress);

        const signature = key.sign(context);

        // Export DER encoded signature in Array
        // this.derSign = signature.toDER();

        return signature;
    }

    /** Return the secret value use for RingCT in long form
     * value = hs(ECDH) + private_spend_key
     * @param {string} privateSpendKey of the owner - length 32 bytes
     * @returns {string} ringCTPrivateKey in 32 bytes format
     */
    getRingCTKeys(privateSpendKey: string) {
        const decodedUTXO = this.checkOwnership(privateSpendKey);
        assert(decodedUTXO, " Can't decode utxo that not belongs");

        return {
            privKey: decodedUTXO.privKey,
            pubKey: decodedUTXO.pubKey,
        };
    }

    /**
     * Restore UTXO instance from result of stealth.genTransactionProof
     * //TODO find other way to do this more elegant
     * @param {object} proof
     * @returns {UTXO} instance of utxo
     */
    static fromProof(proof: Proof): UTXO {
        return new UTXO({
            '0': {
                '0': proof.commitment.slice(1, 33).join(''),
                '1': proof.onetimeAddress.slice(1, 33).join(''),
                '2': proof.txPublicKey.slice(1, 33).join(''),
            },
            '1': {
                '0': BigInteger.fromBuffer(proof.commitment.slice(-33)).isEven() ? '0' : '1',
                '1': BigInteger.fromBuffer(proof.onetimeAddress.slice(-33)).isEven() ? '0' : '1',
                '2': BigInteger.fromBuffer(proof.txPublicKey.slice(-33)).isEven() ? '0' : '1',
            },
            '2': {
                '0': proof.encryptedAmount,
                '1': proof.encryptedMask,
            },
            '3': proof.index,
        });
    }
}

export default UTXO;
