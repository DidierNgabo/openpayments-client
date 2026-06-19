import {
  createAuthenticatedClient,
  isFinalizedGrantWithAccessToken,
  isPendingGrant,
} from '@interledger/open-payments';
import readline from 'readline/promises';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';

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

  const client = await createAuthenticatedClient({
    walletAddressUrl: process.env.client_address,
    privateKey: process.env.privateKey,
    keyId: process.env.keyId,
  });

  //fetching wallet addresses

  const customerAddress = await client.walletAddress.get({
    url: process.env.client_address,
  });
  const merchantWalletAddress = await client.walletAddress.get({
    url: process.env.receiver_address,
  });
  const platformWalletAddress = await client.walletAddress.get({
    url: process.env.sender_address,
  });

  console.log({
    customerAddress,
    merchantWalletAddress,
    platformWalletAddress,
  });

  const NONCE = randomUUID();

  // grant reques
  const merchantIncomingPaymentGrant = await client.grant.request(
    {
      url: merchantWalletAddress.authServer,
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

  console.log({ merchantIncomingPaymentGrant });

  if (!isFinalizedGrantWithAccessToken(merchantIncomingPaymentGrant)) {
    throw new Error('Expected finalized grant');
  }

  //creating an incoming payments

  const merchantAmount = 9900;
  const platformAmount = 100;

  const merchantIncomingPayment = await client.incomingPayment.create(
    {
      url: merchantWalletAddress.resourceServer,
      accessToken: merchantIncomingPaymentGrant.access_token.value,
    },
    {
      walletAddress: merchantWalletAddress.id,
      metadata: {
        description: 'Product order',
      },
      incomingAmount: {
        assetCode: merchantWalletAddress.assetCode,
        assetScale: merchantWalletAddress.assetScale,
        value: merchantAmount.toString(),
      },
    },
  );

  console.log('Created merchant incoming payment', merchantIncomingPayment);

  await promptNextStep();

  const platformIncomingPayment = await client.incomingPayment.create(
    {
      url: platformWalletAddress.resourceServer,
      accessToken: merchantIncomingPaymentGrant.access_token.value,
    },
    {
      walletAddress: platformWalletAddress.id,
      metadata: {
        description: 'Service Fee',
      },
      incomingAmount: {
        assetCode: platformWalletAddress.assetCode,
        assetScale: platformWalletAddress.assetScale,
        value: platformAmount.toString(),
      },
    },
  );

  console.log('Created platform incoming payment', platformIncomingPayment);

  await promptNextStep();

  // request quote

  const customerQuoteGrant = await client.grant.request(
    {
      url: customerAddress.authServer,
    },
    {
      access_token: {
        access: [
          {
            type: 'quote',
            actions: ['create'],
          },
        ],
      },
    },
  );

  if (!isFinalizedGrantWithAccessToken(customerQuoteGrant)) {
    throw new Error('Expected finalized grant');
  }

  console.log('quote', customerQuoteGrant);

  await promptNextStep();

  // Merchant
  const merchantQuote = await client.quote.create(
    {
      url: customerAddress.resourceServer,
      accessToken: customerQuoteGrant.access_token.value,
    },
    {
      method: 'ilp',
      walletAddress: customerAddress.id,
      receiver: merchantIncomingPayment.id,
    },
  );

  console.log('merchant quote', merchantQuote);
  // Platform
  const platformQuote = await client.quote.create(
    {
      url: customerAddress.resourceServer,
      accessToken: customerQuoteGrant.access_token.value,
    },
    {
      method: 'ilp',
      walletAddress: customerAddress.id,
      receiver: platformIncomingPayment.id,
    },
  );

  console.log('platform quote', platformQuote);

  await promptNextStep();

  // customer grant

  const combinedAmount = merchantAmount + platformAmount;
  const pendingCustomerOutgoingPaymentGrant = await client.grant.request(
    {
      url: customerAddress.authServer,
    },
    {
      access_token: {
        access: [
          {
            type: 'outgoing-payment',
            actions: ['create'],
            limits: {
              debitAmount: {
                assetCode: customerAddress.assetCode,
                assetScale: customerAddress.assetScale,
                value: combinedAmount.toString(),
              },
            },
            identifier: customerAddress.id,
          },
        ],
      },
      interact: {
        start: ['redirect'],
        finish: {
          method: 'redirect',
          uri: 'http://google.com',
          nonce: NONCE,
        },
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
    url: pendingCustomerOutgoingPaymentGrant.continue.uri,
    accessToken:
      pendingCustomerOutgoingPaymentGrant.continue.access_token.value,
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
  // Merchant
  const customerOutgoingPaymentToMerchant = await client.outgoingPayment.create(
    {
      url: customerWalletAddress.resourceServer,
      accessToken: customerOutgoingPaymentGrant.access_token.value,
    },
    {
      walletAddress: customerWalletAddress.id,
      quoteId: merchantQuote.id,
    },
  );
  // Platform
  const customerOutgoingPaymentToPlatform = await client.outgoingPayment.create(
    {
      url: customerWalletAddress.resourceServer,
      accessToken: customerOutgoingPaymentGrant.access_token.value,
    },
    {
      walletAddress: customerWalletAddress.id,
      quoteId: platformQuote.id,
    },
  );
})();
