
// Exports
module.exports = main;





// Constants
let rootDir = __dirname + "/../../..";

/*
 *
 * Packages
 *
 */
// Our custom imports
let log = require( `${ rootDir }/lib/logger.js` );
let Person = require( `${ rootDir }/lib/entities/Person.js` );
let PersonActivity = require( `${ rootDir }/lib/entities/PersonActivity.js` );
let PersonOnWebsiteWebhook = require( `${ rootDir }/lib/webhooks/person-on-website.js` );


/*
 * -/-/-/-/-/
 * Add a person
 * -/-/-/-/-/
 */
function main ( router, middleware ) {

	// First, allow pre-flight requests
	router.options( "/v2/hooks/person-on-website", middleware.allowPreFlightRequest );


	router.post( "/v2/hooks/person-on-website", async function ( req, res ) {

		// res.header( "Access-Control-Allow-Origin", "*" );
		res.header( "Access-Control-Allow-Origin", req.headers.origin );
		res.header( "Access-Control-Allow-Credentials", "true" );

		/* ------------------------------------------- \
		 * 1. Extract relevant data from the Request
		 \-------------------------------------------- */
		let client = req.body.client;
		let phoneNumber = req.body.phoneNumber;
		// If the required data has not been provided
		if ( ! client || ! phoneNumber ) {
			res.status( 400 );
			res.json( {
				code: 400,
				message: "Please provide the phone-number and associated client."
			} );
			return;
		}

		// Optional attributes
		let deviceId = req.body.deviceId;
		let interests = req.body.interests;
		let name = req.body.name;
		let emailAddresses = req.body.emailAddresses;
		let where = req.body.where;



		/* ----------------------- \
		 * 2. Validate the data
		 \------------------------ */
		if ( ! /^\+\d+/.test( phoneNumber ) )
			return invalidInputResponse( res, "Please provide a valid phone-number." );

		if ( ! ( interests instanceof Array ) )
			if ( typeof interests == "string" )
				interests = [ interests ];
			else
				interests = [ ];

		if ( ! ( emailAddresses instanceof Array ) )
			if ( typeof emailAddresses == "string" )
				emailAddresses = [ emailAddresses ];
			else
				emailAddresses = [ ];



		/* ----------------------- \
		 * 3. Get the Person
		 \------------------------ */
		let person = new Person( client, phoneNumber );
		try {
			await person.get();
		}
		catch ( e ) {
			res.status( 404 );
			res.json( {
				code: 404,
				message: "Could not find a Person with the details provided."
			} );
			res.end();
			return;
		}



		/* ---------------- \
		 * 4. Respond back
		 \----------------- */
		res.status( 200 );
		res.json( {
			code: 200,
			message: "The Person's activity has been acknowledged."
		} );
		res.end();



		/* ----------------------------------------------------------- \
		 * 5. Determine if the code that follows needs to be executed
		 \------------------------------------------------------------ */
		// A. If the Person does not have an Id
		if ( ! person.id )
			return;

		// B. If the Person's last activity was less than 10 minutes ago
		let personActivity = new PersonActivity( "person/on/website" );
		personActivity.associatePerson( client, phoneNumber );
		let lastActivity;
		try {
			lastActivity = await personActivity.getMostRecent();
		}
		catch ( e ) {
			return;
		}
		if ( lastActivity._id ) {
			let tenMinutes = 10 * 60 * 1000;
			if ( Date.now() - lastActivity.when < tenMinutes )
				return;
		}



		/* ------------------------------- \
		 * 6. Update the in-memory Person
		 \-------------------------------- */
		person
			.hasDeviceIds( deviceId )
			.hasEmailAddress( ...emailAddresses )
			.isInterestedIn( ...interests );



		/* ------------------------- \
		 * 7. Record a new Activity
		 \-------------------------- */
		let activity = new PersonActivity( "person/on/website" );
		activity.associatePerson( client, phoneNumber );
		activity.setServiceProvider( "Google Analytics" );
		activity.setData( { deviceId, where } );

		try {
			await activity.record();
		}
		catch ( e ) {
			await log.toUs( {
				context: "Request to acknowledge Person on the website",
				message: "Recording a new activity",
				data: e
			} );
		}



		/* ----------------------- \
		 * 8. Trigger the Webhook
		 \------------------------ */
		let webhookEvent = new PersonOnWebsiteWebhook( client );
		webhookEvent.attachData( Object.assign( { }, person, { where } ) );
		try {
			await webhookEvent.handle();
		}
		catch ( e ) {
			await log.toUs( {
				context: "Request to acknowledge Person on the website",
				message: e.message,
				data: e
			} )
		}



		/* ----------------------------------- \
		 * 9. Update the Person
		 \------------------------------------ */
		try {
			await person.update();
		}
		catch ( e ) {
			await log.toUs( {
				context: `Request to acknowledge Person on the website`,
				message: "Updating a Person",
				data: e
			} );
		}

	} );

	return router;

}



/* ----------------- \
 * Helper functions
 \------------------ */
function invalidInputResponse ( response, message ) {
	response.status( 422 );
	response.json( {
		code: 422,
		message: message
	} );
	response.end();
}