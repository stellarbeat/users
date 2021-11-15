import * as express from 'express';
import * as bodyParser from 'body-parser';
import { body, param, validationResult } from 'express-validator';
import { Contact } from './Contact';
import { config } from 'dotenv';
import { Encryption } from './Encryption';
import { Hasher } from './Hasher';
import { createConnection, getConnection, getRepository } from 'typeorm';
import { Server } from 'net';
import * as basicAuth from 'express-basic-auth';

config();
const consumerName = process.env.CONSUMER_NAME;
if (!consumerName) throw new Error('No consumer nane');
const consumerSecret = process.env.CONSUMER_SECRET;
if (!consumerSecret) throw new Error('No consumer secret');
const users = {} as { [username: string]: string };
users[consumerName] = consumerSecret;
const secretString = process.env.ENCRYPTION_SECRET;
if (!secretString) throw new Error('No encryption secret');
const secret = Buffer.from(secretString, 'base64');
const hashSecretString = process.env.HASH_SECRET;
if (!hashSecretString) throw new Error('No hash secret');
const hashSecret = Buffer.from(hashSecretString, 'base64');
const encryption = new Encryption(secret);
const hasher = new Hasher(hashSecret);
let port = process.env.PORT;
if (!port) port = '3000';

const api = express();
let server: Server;
api.use(bodyParser.json());
api.use(
	basicAuth({
		users: users
	})
);
api.post(
	'/contact',
	[body('emailAddress').isEmail().normalizeEmail()],
	async function (req: express.Request, res: express.Response) {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}
		try {
			const hash = hasher.hash(Buffer.from(req.body.emailAddress));
			let contact = await getRepository(Contact).findOne({
				where: {
					hash: hash.toString('base64')
				}
			});
			if (contact)
				return res.status(200).json({
					contactId: contact.id
				});

			const { cipher, nonce } = encryption.encrypt(
				Buffer.from(req.body.emailAddress)
			);

			//todo mailgun email address validation
			contact = new Contact(
				cipher.toString('base64'),
				nonce.toString('base64'),
				hash.toString('base64')
			);

			await contact.save();
			return res.status(200).json({
				contactId: contact.id
			});
		} catch (e) {
			return res.status(500).json({ msg: 'Something went wrong' });
		}
	}
);
api.delete(
	'/contact/:userId',
	[param('userId').isUUID(4)],
	async function (req: express.Request, res: express.Response) {
		console.log(req.body);
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}
		try {
			const contact = await getRepository(Contact).findOne(req.params.userId);
			if (!contact) return res.status(404).json({ msg: 'Contact not found' });
			await contact.remove();
			return res.status(200).json({ msg: 'Contact removed' });
		} catch (e) {
			return res.status(500).json({ msg: 'Something went wrong' });
		}
	}
);

api.post(
	'/contact/:userId/message',
	[param('userId').isUUID(4), body('message').isString().notEmpty()],
	async function (req: express.Request, res: express.Response) {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}
		try {
			const contact = await getRepository(Contact).findOne(req.params.userId);
			if (!contact) return res.status(404).json({ msg: 'Contact not found' });
			console.log(req.body.message);
		} catch (e) {
			return res.status(500).json({ msg: 'Something went wrong' });
		}
	}
);

async function listen() {
	await createConnection();
	server = api.listen(port, () =>
		console.log('api listening on port: ' + port)
	);
}

listen();

process.on('SIGTERM', async () => {
	console.log('SIGTERM signal received: closing HTTP server');
	await stop();
});
process.on('SIGINT', async () => {
	console.log('SIGTERM signal received: closing HTTP server');
	await stop();
});

async function stop() {
	await getConnection().close();
	await server.close(() => {
		console.log('HTTP server closed');
	});
}
