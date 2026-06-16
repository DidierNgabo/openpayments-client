import {
  createAuthenticatedClient,
  isFinalizedGrantWithAccessToken,
  isPendingGrant,
} from '@interledger/open-payments';
import readline from 'readline/promises';
import dotenv from 'dotenv';

(async () => {
  const readlineInterface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const promptNextStep = () =>
    readlineInterface.question(`\nPress enter for next step...\n`);

  const result = dotenv.config();

  if (result.error) {
    throw result.error;
  }

  console.log({
    cliendAdress: process.env.client_address,
    senderAddress: process.env.sender_address,
    receiverAddress: process.env.receiver_address,
    key: process.env.keyId,
    privateKey: process.env.privateKey,
  });

  const client = await createAuthenticatedClient({
    walletAddressUrl: process.env.client_address,
    privateKey: process.env.privateKey,
    keyId: process.env.keyId,
  });

  //fetching wallet addresses

  const clientAddress = await client.walletAddress.get({
    url: process.env.client_address,
  });
  const receiverWalletAddress = await client.walletAddress.get({
    url: process.env.receiver_address,
  });
  const senderWalletAddress = await client.walletAddress.get({
    url: process.env.sender_address,
  });

  console.log({ senderWalletAddress, receiverWalletAddress });

  // grant request to make a payment from the sender to the receiver
  const incomingPaymentGrant = await client.grant.request(
    {
      url: receiverWalletAddress.authServer,
    },
    {
      access_token: {
        access: [
          {
            type: 'incoming-payment',
            actions: ['create'],
          },
        ],
      },
    },
  );

  console.log({ incomingPaymentGrant });

  if (!isFinalizedGrantWithAccessToken(incomingPaymentGrant)) {
    throw new Error('Expected finalized grant');
  }

  //creating an incoming payments

  const totalAmount = 5000;

  const incomingPayment = await client.incomingPayment.create(
    {
      url: receiverWalletAddress.resourceServer,
      accessToken: incomingPaymentGrant.access_token.value,
    },
    {
      walletAddress: receiverWalletAddress.id,
      metadata: {
        description: 'Lunch order',
      },
      incomingAmount: {
        assetCode: receiverWalletAddress.assetCode,
        assetScale: receiverWalletAddress.assetScale,
        value: totalAmount.toString(),
      },
    },
  );

  console.log('Created incoming payment', incomingPayment);

  await promptNextStep();

  const outgoingPaymentGrant = await client.grant.request(
    {
      url: senderWalletAddress.authServer,
    },
    {
      access_token: {
        access: [
          {
            type: 'outgoing-payment',
            actions: ['create'],
            limits: {
              debitAmount: {
                assetCode: senderWalletAddress.assetCode,
                assetScale: senderWalletAddress.assetScale,
                value: totalAmount.toString(),
              },
            },
            identifier: senderWalletAddress.id,
          },
        ],
      },
      interact: {
        start: ['redirect'],
      },
    },
  );

  if (!isPendingGrant(outgoingPaymentGrant)) {
    throw new Error('Expected pending grant');
  }

  console.log('Got pending outgoing payment grant', outgoingPaymentGrant);

  await promptNextStep();

  // 6. Continue outgoing payment grant
  const finalizedOutgoingPaymentGrant = await client.grant.continue({
    url: outgoingPaymentGrant.continue.uri,
    accessToken: outgoingPaymentGrant.continue.access_token.value,
  });

  if (!isFinalizedGrantWithAccessToken(finalizedOutgoingPaymentGrant)) {
    throw new Error('Expected finalized grant');
  }

  console.log(
    'Got finalized outgoing payment grant',
    finalizedOutgoingPaymentGrant,
  );

  await promptNextStep();

  // 7. Create first outgoing payment
  const outgoingPayment = await client.outgoingPayment.create(
    {
      url: senderWalletAddress.resourceServer,
      accessToken: finalizedOutgoingPaymentGrant.access_token.value,
    },
    {
      walletAddress: senderWalletAddress.id,
      incomingPayment: incomingPayment.id,
      debitAmount: {
        assetCode: senderWalletAddress.assetCode,
        assetScale: senderWalletAddress.assetScale,
        value: totalAmount.toString(),
      },
      metadata: {
        description: 'Lunch payment',
      },
    },
  );

  console.log('Created outgoing payment', outgoingPayment);
})();
