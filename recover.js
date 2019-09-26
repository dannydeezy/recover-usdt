

/**
 * TODO: fill out the below fields with your specific information for this recovery
 */

const address = ''; // the bitgo address where the usdt is stuck
const walletPasscode = ''; // the passcode for the bitgo wallet that contains the above address
const fundingTxHex = ''; // the transaction hex for any utxo owned by the above address - this will fund the recovery transaction
const destAddr = ''; // the destination address where you'd like the tether sent to
const changeAddr = address; // the address where change from the transaction will be sent. recommended to leave this as is (changeAddr = address)
const tetherAmount = 1e8; // the amount of tether to send in the recovery transaction (1e8 = 1 usdt)
const ep1 = {}; // the value of Box A of your wallet keycard - this is your encrypted user key
const ep2 = {}; // the value of Box B of your wallet keycard - this is your encrypted backup key
const bitgoPublicKey = ''; // the value of Box C of your wallet keycard - this is the bitgo public key for your wallet
const addressIndex = -1; // this is the 'index' of the address being used. find this using BitGoJS and the 'wallet.getAddress({address})' function
const addressChain = 10; // this is the 'chain' of the address being used. find this using BitGoJS and the 'wallet.getAddress({address})' function
const mainnet = true; // leave as true for mainnet. Set to false for testnet
/**
 * End of custom fields
 */


const bitcoin = require('bitcoinjs-lib');
const sjcl = require('sjcl');
const bip32 = require('bip32');
const Promise = require('bluebird');
const co = Promise.coroutine;
const omniSend = require('omni-simple-send');
const toBig = 100000000;

const getFundingUTXO = function(tx) {
  const network = mainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  for (const index in tx.outs) {
    const a = bitcoin.address.fromOutputScript(tx.outs[index].script, network);
    if (a === address) {
      return {
        vout: index,
        value: tx.outs[index].value,
      };
    }
  }
  throw new Error(`The fundingTxHex does not include an output with the address ${address}`);
}

const signTx = function(pubkeys, prvs, path) {
    const inTx = bitcoin.Transaction.fromHex(fundingTxHex);
    const fundingUTXO = getFundingUTXO(inTx);
    const txInAmt = fundingUTXO.value;
    const dust = Math.round(.0000059 * toBig);
    const miningFee = Math.round(.000122 * toBig);
    const changeAmt = Math.round(txInAmt - dust - miningFee);
    const txb = new bitcoin.TransactionBuilder();

    const token = 31   //USDT
    const omniData = omniSend(token, tetherAmount);
    const customOPReturn = omniData.toString('hex');
    const data = Buffer.from(customOPReturn, 'hex');
    const embed = bitcoin.payments.embed({ data: [data] });

    txb.addInput(inTx, fundingUTXO.vout);
    txb.addOutput(destAddr, dust);
    txb.addOutput(changeAddr, changeAmt);
    txb.addOutput(embed.output, 0);

    const p2ms = bitcoin.payments.p2ms({ m: 2, pubkeys })
    const p2wsh = bitcoin.payments.p2wsh({ redeem: p2ms })
    const p2sh = bitcoin.payments.p2sh({ redeem: p2wsh })

    let keyPair1 = bip32.fromBase58(prvs[0], txb.network);
    let keyPair2 = bip32.fromBase58(prvs[1], txb.network);

    keyPair1 = keyPair1.derivePath(path);
    keyPair2 = keyPair2.derivePath(path);

    txb.sign(0, keyPair1, p2sh.redeem.output, null, txInAmt, p2wsh.redeem.output);
    txb.sign(0, keyPair2, p2sh.redeem.output, null, txInAmt, p2wsh.redeem.output);

    const finalTx = txb.build();

    console.log('Completed signing recovery transaction. Broadcast the following tx hex at https://www.smartbit.com.au/txs/pushtx : \n\n');
    console.log(finalTx.toHex());
}

const execute = co(function *() {

    const p1 = sjcl.decrypt(walletPasscode, JSON.stringify(ep1));
    const p2 = sjcl.decrypt(walletPasscode, JSON.stringify(ep2));
    const prvs = [p1, p2];

    if (prvs.length !== 2) {
        throw new Error('Expected 2 private keys but got ' + prvs.length);
    }

    const node0 = bip32.fromBase58(p1);
    const node1 = bip32.fromBase58(p2);
    const node2 = bip32.fromBase58(bitgoPublicKey);
    const path = `0/0/${addressChain}/${addressIndex}`;
    const child0 = node0.derivePath(path);
    const child1 = node1.derivePath(path);
    const child2 = node2.derivePath(path);
    const pubkeys = [child0.publicKey, child1.publicKey, child2.publicKey];
    const result = bitcoin.payments.p2sh({
        redeem: bitcoin.payments.p2wsh({
            redeem: bitcoin.payments.p2ms({ m: 2, pubkeys })
        })
    });

    if(result.address !== address) {
        console.log(result.address);
        console.log(address);
        throw new Error ('Addresses dont match');
    }

    console.log('Got wallet data, now attempting to sign transaction...');
    signTx(pubkeys, prvs, path);

});

execute();
