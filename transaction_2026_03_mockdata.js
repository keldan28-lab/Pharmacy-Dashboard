console.log(' Loading transaction_2026_03_mockdata.js...');
const TRANSACTION_2026_03 = {

"100017": { history: [ {transDate: "2026-03-05", sublocation: "", sendToLocation: "SRIBC", transactionType: "Pyxis Refill", "TransQty": 11},
{transDate: "2026-03-05", sublocation: "", sendToLocation: "", transactionType: "Unload From Pyxis", "TransQty": -11},
{transDate: "2026-03-07", sublocation: "VC1", sendToLocation: "EDD", transactionType: "Dispense", "TransQty": -1},
{transDate: "2026-03-08", sublocation: "", sendToLocation: "2WA", transactionType: "Pyxis Refill", "TransQty": 20},
{transDate: "2026-03-08", sublocation: "VC1", sendToLocation: "2WB", transactionType: "Pyxis Send", "TransQty": -20},
{transDate: "2026-03-08", sublocation: "VC1", sendToLocation: "EDD", transactionType: "Redispense", "TransQty": -1},
{transDate: "2026-03-09", sublocation: "VC1", sendToLocation: "2WB", transactionType: "Dispense", "TransQty": -1},
]
}
};
globalThis.TRANSACTION_2026_03 = TRANSACTION_2026_03;
console.log('? TRANSACTION_2026_03 defined!', Object.keys(TRANSACTION_2026_03).length, 'items');
