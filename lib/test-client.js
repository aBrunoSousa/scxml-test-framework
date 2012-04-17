//specify on the command-line tests to run...scxml files?

//read tests from filesystem

//run in two modes: parallel and serial

//specify test-server to communicate with

//client-server protocol:
//send sc to load; initial configuration returned in the response, along with id token. compare
//send event and id token; return new configuration; compare
//when done, send "done" event so server can optionally clean up.

//do the simplest thing first: run sequentially

var fs = require('fs'),
    path = require('path'),
    _ = require('underscore'),
    request = require('request'),
    assert = require('assert'),
    nopt = require('nopt'),
    knownOpts = { 
        "parallel" : Boolean,
        "test-server-url" : String
    },
    shortHands = { 
        "p" : "--parallel",
        "t" : "--test-server-url"
    },
    parsed = nopt(knownOpts, shortHands);

var url = parsed["test-server-url"] || "http://localhost:42000/";
var parallel = parsed.parallel;
var scxmlTestFiles = parsed.argv.remain;

//TODO: if scxmlTestFiles is empty, get all files ../test/*/*.scxml

var testScxml = scxmlTestFiles.map(function(f){return fs.readFileSync(f,'utf8');});
var testJson = scxmlTestFiles.map(function(s){return path.join(path.dirname(s),path.basename(s,'.scxml') + '.json');}).
                map(function(f){return fs.readFileSync(f,'utf8');}).map(JSON.parse);
var testPairs = _.zip(scxmlTestFiles,testScxml,testJson);

var testsPassed = [], testsFailed = [], testsErrored = [];

function testPair(pair,done){
    var testName = pair[0], scxml = pair[1], testJson = pair[2], sessionToken, event;

    function handleResponse(error, response, body){
        if(error || response.statusCode !== 200){
            console.error("Error in response",error,body);
            testsErrored.push(testName); 
            done();
            return;
        }

        try{
            assert.deepEqual(
                body.nextConfiguration.sort(),
                ( ((typeof sessionToken === 'number') && event) ? event.nextConfiguration : testJson.initialConfiguration).sort());
        }catch(e){
            console.error(e);
            testsFailed.push(testName);
            done();
            return;
        }

        if((typeof body.sessionToken === 'number') && (typeof sessionToken === 'undefined')){
            sessionToken = body.sessionToken;   //we send this along with all subsequent requests
        }

        sendEvent();
    }

    //send scxml
    console.log("loading",testName);
    request.post( { url : url, json : { load : scxml } }, handleResponse);

    //send events until there are no more events
    function sendEvent(){
        event = testJson.events.shift();
        if(event){
            function doSend(){
                console.log("sending event",event.event);
                request.post(
                    {
                        url : url,
                        json : {
                            event : event.event,
                            sessionToken : sessionToken 
                        }
                    },
                    handleResponse);
            }

            if(event.after){
                console.log("waiting to send",event.after);
                setTimeout(doSend,event.after);
            }else{
                doSend();
            }
        }else{
            console.log("done with test",testName);
            testsPassed.push(testName); 
            done();
        }
    }
}

function complete(){
    //print summary
    //TODO: optionally disable
    console.log("SUMMARY");
    console.log("Tests passed",testsPassed);
    console.log("Tests failed",testsFailed);
    console.log("Tests errored",testsErrored);
    process.exit(testsFailed.length + testsErrored.length);
}

if(parallel){
    //run in parallel
    function done(){
        if((testsPassed.length + testsFailed.length + testsErrored.length) === testScxml.length) complete();
    }
    testPairs.forEach(function(pair){testPair(pair,done);});
}else{
    //run sequentially
    (function(pair){
        if(pair){
            var f = arguments.callee;
            var nextStep = function(){ f(testPairs.pop()); };
            testPair(pair,nextStep); 
        }else{
            //we're done
            complete();
        }
    })(testPairs.pop());
}
