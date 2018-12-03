
/**
 * TODO: fill out the below fields with your specific information for this recovery
 */
const pathToBitGoJSIndex = '../BitGoJS/src/index.js';
const accessToken = '';
const walletId = '';
const address = ''
const walletPasscode = '';
const rawInTx = '';
const inputIndex = -1;
let txInAmt = -1;
const destAddr = '';
const changeAddr = '';
const tetherAmount = 5e8 // 5 USDT
/**
 * End of custom fields
 */


const bitcoin = require('bitcoinjs-lib');
const bip32 = require('bip32');
const Promise = require('bluebird');
const co = Promise.coroutine;
const omniSend = require('omni-simple-send');
const BitGoJS = require(pathToBitGoJSIndex);
const bitgo = new BitGoJS.BitGo({env:"prod"});
bitgo.authenticateWithAccessToken({accessToken});
const coin = 'btc';

const signTx = function(pubkeys, prvs) {
    const toBig = 100000000;
    txInAmt *= toBig;
    const dust = .0000059 * toBig;
    const miningFee = .000122 * toBig;
    const changeAmt = txInAmt - dust - miningFee;
    const txb = new bitcoin.TransactionBuilder();
    const inTx = bitcoin.Transaction.fromHex(rawInTx);
    const token = 31   //USDT
    const omniData = omniSend(token, tetherAmount);
    const customOPReturn = omniData.toString('hex');
    const data = Buffer.from(customOPReturn, 'hex');
    const embed = bitcoin.payments.embed({ data: [data] })

    txb.addInput(inTx, inputIndex);
    txb.addOutput(destAddr, dust);
    txb.addOutput(changeAddr, changeAmt);
    txb.addOutput(embed.output, 0);

    const p2ms = bitcoin.payments.p2ms({ m: 2, pubkeys })
    const p2wsh = bitcoin.payments.p2wsh({ redeem: p2ms })
    const p2sh = bitcoin.payments.p2sh({ redeem: p2wsh })

    const keyPair1 = bip32.fromBase58(prvs[0]);
    const keyPair2 = bip32.fromBase58(prvs[1]);

    txb.sign(0, keyPair1, p2sh.redeem.output, null, txInAmt, p2wsh.redeem.output);
    txb.sign(0, keyPair2, p2sh.redeem.output, null, txInAmt, p2wsh.redeem.output);

    const finalTx = txb.build();

    console.log('Completed signing recovery transaction. Broadcast the following tx hex at https://www.smartbit.com.au/txs/pushtx : \n\n');
    console.log(finalTx.toHex());
}

const execute = co(function *() {
    const wallet = yield bitgo.coin(coin).wallets().get({ id: walletId });
    const keyids = wallet._wallet.keys;
    const keychains = [];
    const prvs = [];
    for(i in keyids) {
        const keyid = keyids[i];
        const keychain = yield bitgo.coin(coin).keychains().get({ id: keyid });
        keychains.push(keychain);
        if (keychain.encryptedPrv) {
            const prv = bitgo.decrypt({password:walletPasscode, input:keychain.encryptedPrv});
            prvs.push(prv);
        }
    }

    if (prvs.length !== 2) {
        throw new Error('Expected 2 private keys but got ' + prvs.length);
    }

    const addr = yield wallet.getAddress({address});
    const node0 = bip32.fromBase58(keychains[0].pub);
    const node1 = bip32.fromBase58(keychains[1].pub);
    const node2 = bip32.fromBase58(keychains[2].pub);
    const path = '0/0/' + addr.chain + '/' + addr.index;
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
    signTx(pubkeys, prvs);

});

execute();
