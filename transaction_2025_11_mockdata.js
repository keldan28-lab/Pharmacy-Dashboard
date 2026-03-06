console.log(' Loading transaction_2025_11_mockdata.js...');
const TRANSACTION_2025_11 = {

"100017": { history: [ {transDate: "2025-11-05", sublocation: "", sendToLocation: "SRIBC", transactionType: "Pyxis Refill", "TransQty": 11},
{transDate: "2025-11-05", sublocation: "", sendToLocation: "", transactionType: "Unload From Pyxis", "TransQty": -11},
{transDate: "2025-11-07", sublocation: "VC1", sendToLocation: "EDD", transactionType: "Dispense", "TransQty": -1},
{transDate: "2025-11-08", sublocation: "", sendToLocation: "2WA", transactionType: "Pyxis Refill", "TransQty": 20},
{transDate: "2025-11-08", sublocation: "VC1", sendToLocation: "2WB", transactionType: "Pyxis Send", "TransQty": -20},
{transDate: "2025-11-08", sublocation: "VC1", sendToLocation: "EDD", transactionType: "Redispense", "TransQty": -1},
{transDate: "2025-11-09", sublocation: "VC1", sendToLocation: "2WB", transactionType: "Dispense", "TransQty": -1},
]
}
};
globalThis.TRANSACTION_2025_11 = TRANSACTION_2025_11;
console.log('? TRANSACTION_2025_11 defined!', Object.keys(TRANSACTION_2025_11).length, 'items');
