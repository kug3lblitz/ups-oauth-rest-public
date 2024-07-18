import express from 'express';
import fetch from 'node-fetch';
import mysql from 'mysql2/promise';

const shipperNo = ''; // your ups account number
const clientId = ''; // your clientID from the ups developer portal
const clientSecret = ''; // your clientSecret from the ups developer portal
const AuthTokenURL = 'https://onlinetools.ups.com/security/v1/oauth/token';
const ShipURL = 'https://onlinetools.ups.com/api/shipments/v2403'; // Production
let shippingLabel;
let trackingNumber;
let shipmentData;
const app = express();
const refnumRegex = /^[0-9][A-Z][0-9]{2}[A-Z]$/; // format this to your own needs to prevent invalid data

app.get('/:ranum', async (req, res) => {
	const { ranum } = req.params;

	if (!refnumRegex.test(ranum)) {
		return res.sendStatus(204);
	}

	async function fetchcustomerData(ranum) {
		/*  sname = shipper name
			saddr = shipper address
			scity = shipper city
			sstate = shipper state
			szip = shipper zip
		*/
		let sname = '';
		let saddr = '';
		let scity = '';
		let sstate = '';
		let szip = '';
		let sphone = '';
		let sfax = '';
		let connection;
		try {
			connection = await mysql.createConnection({
				host: '', // your db host ip
				port: 3306, // default mysql port
				user: '', // your db username
				password: '', // your db password
				database: '' // your db name
			});

			const query = `
			SELECT customer.Name, customer.PhysicalAddress, customer.PhysicalCity, customer.PhysicalState, customer.PhysicalZip, customer.Phone1, customer.Fax1
			FROM customer
			INNER JOIN ra ON customer.ID = ra.customerID
			WHERE ra.Num = ?;
			`; // your query to get the customer data
			const [result] = await connection.execute(query, [ranum]);

			if (result.length > 0) {
				sname = result[0].Name;
				saddr = result[0].PhysicalAddress;
				scity = result[0].PhysicalCity;
				sstate = result[0].PhysicalState;
				szip = result[0].PhysicalZip;
				sphone = result[0].Phone1;
				sfax = result[0].Fax1;
				sname = sname.substring(0, 30); // truncate value to no more than 31 characters so that ups doesn't get butthurt
				saddr = saddr.substring(0, 30);

				shipmentData = {
					ShipmentRequest: {
						Request: {
							SubVersion: '1801',
							RequestOption: 'nonvalidate',
							TransactionReference: { CustomerContext: '' }
						},
						Shipment: {
							Description: '',
							Shipper: {
								Name: sname,
								AttentionName: sname,
								TaxIdentificationNumber: '',
								Phone: {
									Number: sphone,
									Extension: ' '
								},
								ShipperNumber: `${shipperNo}`,
								FaxNumber: sfax,
								Address: {
									AddressLine: [saddr],
									City: scity,
									StateProvinceCode: sstate,
									PostalCode: szip,
									CountryCode: 'US'
								}
							},
							ShipTo: {
								Name: '', // your organization name
								AttentionName: 'Receiving',
								Phone: {
									Number: ''
								},
								Address: {
									AddressLine: [''],
									City: '',
									StateProvinceCode: '',
									PostalCode: '',
									CountryCode: 'US'
								},
								Residential: ' '
							},
							ShipFrom: {
								Name: sname,
								AttentionName: sname,
								Phone: { Number: '1234567890' },
								FaxNumber: '1234567890',
								Address: {
									AddressLine: [saddr],
									City: scity,
									StateProvinceCode: sstate,
									PostalCode: szip,
									CountryCode: 'US'
								}
							},
							PaymentInformation: {
								ShipmentCharge: {
									Type: '01',
									BillShipper: { AccountNumber: `${shipperNo}` }
								}
							},
							Service: {
								Code: '03',
								Description: 'UPS Ground'
							},
							Package: {
								Description: ' ',
								Packaging: {
									Code: '02',
									Description: 'guns, drugs, booze, and dirty magazines'
								},
								Dimensions: {
									UnitOfMeasurement: {
										Code: 'IN',
										Description: 'Inches'
									},
									Length: '10',
									Width: '30',
									Height: '45'
								},
								PackageWeight: {
									UnitOfMeasurement: {
										Code: 'LBS',
										Description: 'Pounds'
									},
									Weight: '5'
								},
								ReferenceNumber: {
									Value: ranum,
									BarCodeIndicator: {
										Code: '02',
										Value: ranum
									}
								}
							}
						},
						LabelSpecification: {
							LabelImageFormat: {
								Code: 'GIF',
								Description: 'GIF'
							},
							HTTPUserAgent: 'Mozilla/4.5',
						}
					}
				};
				return shipmentData;
			}
		} catch (error) {
			console.error('Error inserting data: ', error);
			res.status(500).send(error);
		} finally {
			if (connection) {
				connection.end();
			}
		}
	}
	
	async function getAccessToken() {
		try {
			const base64String = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
			const response = await fetch(AuthTokenURL, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					'Authorization': `Basic ${base64String}`,
					'X-Merchant-Id': clientId,
					'Accept': 'application/json'
				},
				body: new URLSearchParams({
					'grant_type': 'client_credentials'
				})
			});

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const data = await response.json();
			return data.access_token;
		} catch (error) {
			console.error('Error fetching access token:', error);
			throw error;
		}
	}

	async function createShipment(accessToken, shipmentData) {
		try {
			const urlWithQuery = `${ShipURL}/ship?`;

			const response = await fetch(urlWithQuery, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'transId': 'string',
					'transactionSrc': 'testing',
					'Authorization': `Bearer ${accessToken}`,
				},
				body: JSON.stringify(shipmentData)
			});

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const data = await response.json();
			return data;
		} catch (error) {
			console.error('Error creating shipment:', error);
			return {success: false, error};
		}
	}

	async function generateLabel() {
		await fetchcustomerData(ranum);
		const accessToken = await getAccessToken();
		const shipmentResponse = await createShipment(accessToken, shipmentData);
		trackingNumber = shipmentResponse.ShipmentResponse.ShipmentResults.ShipmentIdentificationNumber;
		shippingLabel = shipmentResponse.ShipmentResponse.ShipmentResults.PackageResults[0].ShippingLabel.GraphicImage;
		return shippingLabel;
	}

	async function insertTrackingData(ranum, trackingNumber) {
		let connection;
	
		try {
			connection = await mysql.createConnection({
				host: '', // your db host ip
				port: 3306, // default mysql port
				user: '', // your db username
				password: '', // your db password
				database: '' // your db name
			});
	
			const query = `INSERT INTO eratrackingids (RANum, TrackingID) VALUES (?, ?)`;
			const [result] = await connection.execute(query, [ranum, trackingNumber]);
			console.log(`Insert successful: Tracking#: ${trackingNumber}`, result);
		} catch (error) {
			console.error('Error inserting data: ', error);
			res.status(500).send(error);
		} finally {
			if (connection) {
				connection.end();
			}
		}
	}

	try {
		const shippingLabel = await generateLabel();
		await insertTrackingData(ranum, trackingNumber);
		res.send(`<!DOCTYPE html>
		<html lang="en">
		<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>Shipping Label</title>
		<style>
			body {
				display: flex;
				justify-content: center;
			}
			#label {
				transform: rotate(90deg);
				max-height: 50vh;
				margin-top: 250px;
			}
			@media print {
				#label {
					width: 100%;
					transform: rotate(90deg);
					page-break-before: auto;
					margin-top: 250px;
				}
			}
		</style>
		</head>
		<body>
		<img id="label" src="data:image/gif;base64, ${shippingLabel}" alt="Shipping Label">
		</body>
		<script>
			window.onload = function() {
				window.print();
			}
		</script>
		</html>`);
	} catch (error) {
		res.status(500).send('Error generating label:', error);
	}
});

app.listen(3000, () => console.log('Server listening on port 3000'));
