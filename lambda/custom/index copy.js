/* eslint-disable  func-names */
/* eslint-disable  no-console */
/* eslint-disable  no-restricted-syntax */

//const MYUSERID = 'amzn1.ask.account.AEDWVBMTVDH4HMGTUUB2TOY7ZHSVCE3PAGUAIPSSBLCFD3G2F7PY6ZBKWX4MBNWNCVIFYES711EXNTLDPAJMFMEWDCPT5PHJJRC5RWYANCTXW7QRACAV5CF5ZR6IDDYB7ENOBKYSRURAH6FO6NTHEKND55BK3BV6LLQ7FU7Y2DJW6XEECHUPDUKRTH4RXURBCJ53YNYMPVLJV2YJA';

const Alexa = require('ask-sdk-core');

const constants = require('./constants');
var _ = require('lodash');

const i18n = require('i18next');
const sprintf = require('i18next-sprintf-postprocessor');
const ISPHelp = require('./helpers/ISPHelper');
const drillSetup = require('./drillSetup/drillSetup');
const data = require('./apl/data/main.json');
const template = require('./apl/templates/main.json');
const tempNoMatch = require('./apl/templates/no_match.json');
const dataNoMatch = require('./apl/data/no_match.json');
const dataNextQuestion = require('./apl/data/next_question.json');
const tempNextQuestion = require('./apl/templates/next_question.json');

// This is required for bespoken proxy to work
var AWS = require('aws-sdk');
AWS.config.update({
    region: "us-east-1"
});

//http://whatdidilearn.info/2018/09/16/how-to-keep-state-between-sessions-in-alexa-skill.html
const {
    DynamoDbPersistenceAdapter
} = require('ask-sdk-dynamodb-persistence-adapter');
const tableName = 'COF-USERS';
const partitionKeyName = 'COF-USERID';
const persistenceAdapter = new DynamoDbPersistenceAdapter({
    tableName,
    partitionKeyName,
    createTable: false
});

const freePackRef = constants.freePackRef;
const states = constants.states;
const languageStrings = constants.languageStrings;
const drills = constants.drills;
var drillLevels = 0;

var QUESTIONS = [];
var ANSWERS = [];

//var speech = new Object(); // object to hold speechoutput and repromptoutput strings

var lastQuestionAsked = '';
var speechOutput = '';

/* INTENT HANDLERS */
const LaunchRequestHandler = {
    canHandle(handlerInput) {
        console.log('Inside LaunchRequestHandler ++++++++++++++++ + handlerInput.requestEnvelope.request.type=' + handlerInput.requestEnvelope.request.type);
        //return handlerInput.requestEnvelope.request.type != "SessionEndedRequest" &&
        return            handlerInput.requestEnvelope.request.type === 'LaunchRequest';
    },
    async handle(handlerInput) {
        console.log('Handling LaunchRequest');
        const attributes = handlerInput.attributesManager.getSessionAttributes();

        return setupLevel(handlerInput);

    },
};

const AnswerHandler = {
    canHandle(handlerInput) {

        const request = handlerInput.requestEnvelope.request;
        console.log('£££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££');
        console.log(request);
        console.log('£££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££££');

        if (request.intent) { // does the type property exist?
            return (request.type === 'IntentRequest' &&
            request.intent.name === 'AnswerIntent' || request.intent.name === 'AnswerIntentNumeric');
        } else {
            return false;
        }
        
    },
    handle(handlerInput) {
        console.log("Handling Answer Handler");
        const attributes = handlerInput.attributesManager.getSessionAttributes();
        const requestAttributes = handlerInput.attributesManager.getRequestAttributes();

        repromptOutput = lastQuestionAsked;

        // set up str based on the type of answer expected
        if (handlerInput.requestEnvelope.request.intent.name === 'AnswerIntent') {
            var str = handlerInput.requestEnvelope.request.intent.slots.ANSWER.value.toUpperCase().replace(/[^A-Z ]/g, ''); // Remove anything that's not a alpha or space
        } else {
            var str = handlerInput.requestEnvelope.request.intent.slots.HOWMANY.value;
        }
        let qta = CheckAnswer(handlerInput, str);

        console.log('QTTA=');
        console.log(qta);
        console.log('speech returned');
        //console.log(speech);
        speechOutput = qta;
        repromptOutput = qta;
        console.log('speechOutput=' + speechOutput);

        if (supportsAPL(handlerInput)) {
            dataNextQuestion.bodyTemplate7Data.text.drill = attributes.drillName;
            dataNextQuestion.bodyTemplate7Data.text.level = requestAttributes.t('LEVEL_TXT', attributes.currentLevel,
                attributes.drillLevels, attributes.questionNum);
            console.log('attributes.skillState === ' + attributes.skillState);
            switch (attributes.skillState) {
                case states.REPLAYLEVEL:
                    dataNextQuestion.bodyTemplate7Data.text.level = requestAttributes.t('ASP_END_OF_LEVEL', attributes.currentLevel, attributes.drillLevels);
                    dataNextQuestion.bodyTemplate7Data.text.question = 'Replay the level?'; // make these requestattrs
                    break;
                case states.ENDOFLEVEL:
                    dataNextQuestion.bodyTemplate7Data.text.level = requestAttributes.t('ASP_END_OF_LEVEL', attributes.currentLevel, attributes.drillLevels);
                    dataNextQuestion.bodyTemplate7Data.text.question = 'Level Completed';
                    break;
                case states.ENDOFDRILLWITHUPSELL:
                    dataNextQuestion.bodyTemplate7Data.text.level = requestAttributes.t('ASP_END_OF_LEVEL', attributes.currentLevel, attributes.drillLevels);
                    dataNextQuestion.bodyTemplate7Data.text.question = requestAttributes.t('ASP_END_OF_DRILL', attributes.drillName);
                    break;
                default:
                    dataNextQuestion.bodyTemplate7Data.text.question = QUESTIONS[attributes.questionNum - 1].replace('?', '');
                    break;
            }

            dataNextQuestion.bodyTemplate7Data.text.score = attributes.levelScore + '/' + QUESTIONS.length;
            return handlerInput.responseBuilder
                .speak(speechOutput)
                .reprompt(repromptOutput)
                .addDirective({
                    type: 'Alexa.Presentation.APL.RenderDocument',
                    version: '1.1',
                    document: tempNextQuestion,
                    datasources: dataNextQuestion
                })
                .getResponse();
        } else {
            return handlerInput.responseBuilder
                .speak(speechOutput)
                .reprompt(requestAttributes.t('HELP_MESSAGE_SHORT'))
                .getResponse();
        }
    },
};

function CheckAnswer(handlerInput, answerIn) {
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    const attributes = handlerInput.attributesManager.getSessionAttributes();

    // repromptoutput in this function requires further attention

    console.log('Checking the answer ' + typeof (answerIn));
    //console.log('NaN ' + isNaN(answerIn));

    console.log('attributes.counter is now ' + attributes.questionNum);
    console.log('answer in is ' + answerIn);

    console.log('ANSWERS=' + ANSWERS);
    var enharmonic = ANSWERS[attributes.questionNum - 1].toString().split('/');
    //var TOF = '';
    //the answer could be a ak key e.g. c major or it could be a number from the key signatures drill
    //if (isNaN(answerIn)) {
    if (enharmonic.includes(answerIn) ? true : false) { // does the given answer match the actual answer?
        speechOutput = getSpeechCon(handlerInput, true);
        attributes.levelScore += 1;
    } else {
        speechOutput = getSpeechCon(handlerInput, false);
    }

    if (attributes.questionNum < QUESTIONS.length) { // Number of keys in the array for this round
        console.log('im confused ' + speechOutput);
        speechOutput += askQuestion(handlerInput);
        //console.log('$$$$$$$$$$$$$$$$$$speech.speech=' + speech.speech);
        repromptOutput = speechOutput;
        //speechOutput += question;
    } else {
        // last question has been asked
        speechOutput += marksOutOfTen(handlerInput);
        console.log('here\'s what came back');
        console.log(speechOutput);
        repromptOutput = speechOutput;

    }

    return speechOutput;

}

function getSpeechCon(handlerInput, type) {
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    return type ? requestAttributes.t('CORRECT_ANSWER') : '<audio src="https://s3-eu-west-1.amazonaws.com/circle-of-fifths/wrong-answer.mp3"/>';
}

const NoIntentHandler = {
    canHandle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
        return request.type === 'IntentRequest' &&
            request.intent.name === 'AMAZON.NoIntent';
    },
    handle(handlerInput) {
        const attributes = handlerInput.attributesManager.getSessionAttributes();
        const requestAttributes = handlerInput.attributesManager.getRequestAttributes();

        if (attributes.skillState === states.RESTART) {
            speechOutput = requestAttributes.t('RESTART_TEST_FALSE') + '. ' + lastQuestionAsked;
            attributes.skillState = states.QUIZ;
            handlerInput.attributesManager.setSessionAttributes(attributes);
            return handlerInput.responseBuilder
                .speak(speechOutput)
                .reprompt(lastQuestionAsked)
                .getResponse();
        } else {
            attributes.skillState = states.EXITSKILL;
            //handlerInput.attributesManager.setSessionAttributes(attributes);
            console.log('>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> WHO IS FIRST <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<)');
            return exitSkill(handlerInput);
        }

    },
};

const YesIntentHandler = {
    canHandle(handlerInput) {
        console.log('inside yesintent handler');
        const request = handlerInput.requestEnvelope.request;
        return request.type === 'IntentRequest' &&
            request.intent.name === 'AMAZON.YesIntent';
    },
    async handle(handlerInput) {
        console.log('handling yesintent');
        const response = handlerInput.responseBuilder;
        const attributes = handlerInput.attributesManager.getSessionAttributes();
        const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
        var speechOutput = '';
        console.log(attributes.skillState);
        switch (attributes.skillState) {
            //case states.STARTLEVEL:
            //    speechOutput = askQuestion(handlerInput);
            //repromptOutput = speechOutput;
            //    break;
            case states.ENDOFLEVEL:
            case states.REPLAYLEVEL:
                setupLevel(handlerInput);
                speechOutput += requestAttributes.t('START_LEVEL_MSG', attributes.drillName, attributes.currentLevel) +
                    '<break time="1s"/>' + askQuestion(handlerInput);
                break;
            case states.ENDOFDRILLWITHREPLAY:
                console.log('A - setting completed to false');
                let idx = getRefIndex(attributes.drillStatus, attributes.currentDrillRef);
                attributes.drillStatus[idx].completed = false;
                attributes.currentLevel = 0;
                speechOutput = setupLevel(handlerInput);
                //}
                break;
            case states.ENDOFDRILLWITHUPSELL:
                return makeUpsell('OK.', getNextPurchasableProduct(handlerInput), handlerInput); // offer the first available purchaseable product. whhat if there are none left to buy???
            case states.STARTLEVEL:
                //speechOutput = startNewLevel(handlerInput);
                speechOutput = speechOutput = askQuestion(handlerInput);
                break;
            default:
                speechOutput = "Sorry i don't understand that! " + attributes.currentQTA;
                break;
        }

        if (supportsAPL(handlerInput)) {
            dataNextQuestion.bodyTemplate7Data.text.drill = attributes.drillName;
            dataNextQuestion.bodyTemplate7Data.text.level = requestAttributes.t('LEVEL_TXT', attributes.currentLevel,
                attributes.drillLevels, attributes.questionNum);
            console.log('THERE ARE MORE QUESTIONS TNA ANSWERS');
            console.log(QUESTIONS);
            console.log(attributes.questionNum);
            dataNextQuestion.bodyTemplate7Data.text.question = attributes.currentQTA;
            dataNextQuestion.bodyTemplate7Data.text.score = attributes.levelScore + '/' + QUESTIONS.length;
            return handlerInput.responseBuilder
                .speak(speechOutput)
                .reprompt(repromptOutput)
                .addDirective({
                    type: 'Alexa.Presentation.APL.RenderDocument',
                    version: '1.1',
                    document: tempNextQuestion,
                    datasources: dataNextQuestion
                })
                .getResponse();
        } else {
            return handlerInput.responseBuilder
                .speak(speechOutput)
                .reprompt(requestAttributes.t('HELP_MESSAGE_SHORT'))
                .getResponse();
        }

    },
};

const WhatIsTheAnswerHandler = {
    canHandle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
        return request.type === 'IntentRequest' &&
            request.intent.name === 'WhatIsTheAnswerIntent';

    },
    handle(handlerInput) {
        const attributes = handlerInput.attributesManager.getSessionAttributes();
        const requestAttributes = handlerInput.attributesManager.getRequestAttributes();

        speechOutput = ANSWERS[attributes.questionNum - 1];
        return handlerInput.responseBuilder
            .speak(speechOutput)
            .reprompt(lastQuestionAsked)
            .getResponse();

    },
};

function askQuestion(handlerInput) {

    const attributes = handlerInput.attributesManager.getSessionAttributes();
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();

    attributes.questionNum++;

    attributes.currentQTA = `Question ${attributes.questionNum}. ${QUESTIONS[attributes.questionNum -1]}`; // convert to requestattribute
    speechOutput = attributes.currentQTA;
    repromptOutput = speechOutput;

    attributes.skillState = states.QUIZ;

    //return showNextQuestion(handlerInput);

    return attributes.currentQTA;
}

function setupLevel(handlerInput) {
    //  PERFORM THE SETUP RELATIVE TO THE CURRENT DRILL.   //
    const attributes = handlerInput.attributesManager.getSessionAttributes();
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();

    console.log('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');
    console.log(handlerInput.requestEnvelope.context.System.user.userId);
    console.log('set up level ********************************************* for ' + attributes.currentDrillRef);
    console.log('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');
    

    attributes.drillName = getDrillName(attributes.currentDrillRef);
    attributes.drillLevels = getNumDrillLevels(attributes.currentDrillRef);
    attributes.levelData = getLevelData(attributes.currentDrillRef, attributes.level);

    //let intro = '<audio src="soundbank://soundlibrary/ui/gameshow/amzn_ui_sfx_gameshow_intro_01"/>';
    let intro = '<audio src="soundbank://soundlibrary/gameshow/gameshow_02"/>';
    if (attributes.skillState === states.FIRSTLAUNCH) {
        intro += requestAttributes.t('FIRST_TIME', attributes.drillName, attributes.drillLevels); // e.g. perfect intervals, 12 levels;
    } else {
        intro += requestAttributes.t('WELCOME_BACK', attributes.drillName,
            attributes.currentLevel) + requestAttributes.t('ASK_IF_READY');
    }

    console.log('############################################');
    console.log(attributes.drillName);
    console.log(attributes.level);
    console.log(attributes.drillLevels);
    console.log(attributes.drillStatus);
    console.log(attributes.currentLevel);
    console.log('############################################');

    attributes.questionNum = 0;
    attributes.levelScore = 0;

    handlerInput.attributesManager.setSessionAttributes(attributes);

    console.log('hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh');
    console.log(attributes);
    console.log('hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh');

    let userId = handlerInput.requestEnvelope.context.System.user.userId;
    QANDA = drillSetup.setupDrill(attributes, userId);

    QUESTIONS = QANDA.QUESTIONS;
    ANSWERS = QANDA.ANSWERS;

    attributes.skillState = states.STARTLEVEL;

    //speechOutput = intro + qta;
    //repromptOutput = qta;
    speechOutput = intro;
    repromptOutput = requestAttributes.t('ASK_IF_READY');

    if (handlerInput.requestEnvelope.session.new === true) {
        if (supportsAPL(handlerInput)) {
            data.bodyTemplate7Data.video.type = 'intro';
            return handlerInput.responseBuilder
                .speak(speechOutput)
                .reprompt(repromptOutput)
                .addDirective({
                    type: 'Alexa.Presentation.APL.RenderDocument',
                    version: '1.1',
                    document: template,
                    datasources: data
                })
                .getResponse();
        }
    }

}

function marksOutOfTen(handlerInput) {
    const attributes = handlerInput.attributesManager.getSessionAttributes();
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();

    const percentScore = attributes.levelScore / QUESTIONS.length * 100;
    var superlative = '';
    //var cont = requestAttributes.t('ASK_PLAY_AGAIN');

    //var s = new Object();

    if (percentScore > 99) {
        //superlative = requestAttributes.t('SUPERLATIVE_100') + ' <audio src="soundbank://soundlibrary/ui/gameshow/amzn_ui_sfx_gameshow_positive_response_02"/>';
        superlative = requestAttributes.t('SUPERLATIVE_100');
        //console.log('attributes.drillStatus[0].drill.level ' + attributes.drillStatus[0].drill.level + '/' + attributes.currentDrill + '/' + drillLevels);
        if (attributes.currentLevel === attributes.drillLevels) { // Have all rounds in this drill been completed?
            // here we need to check which drills the user owns and offer the next one not owned
            console.log('end of drill');
            attributes.nextProd = getNextPurchasableProduct(handlerInput);
            console.log('next prod is');
            console.log(attributes.nextProd);
            // if all drills have been purchased go back to any unfinished drills. If all drills have been purchaed & completed do soemthing mad!
            if (attributes.nextProd.referenceName === undefined) {
                speechOutput = 'no more drills buddy.';
            } else {
                speechOutput = requestAttributes.t('END_OF_DRILL', attributes.drillName, attributes.nextProd.referenceName);
            }
            repromptOutput = speechOutput;
            attributes.skillState = states.ENDOFDRILLWITHUPSELL; // time to upsell
            console.log('B - setting completed to true');

            let idx = getRefIndex(attributes.drillStatus, attributes.currentDrillRef);
            attributes.drillStatus[idx].completed = true;
            console.log('----------______----------____________');
            console.log(attributes.drillStatus);
        } else {
            speechOutput = requestAttributes.t('END_LEVEL_MESSAGE_1', attributes.drillName, attributes.currentLevel,
                            attributes.levelScore, QUESTIONS.length) + superlative + requestAttributes.t('ASK_PLAY_NEXT_LEVEL');
            attributes.currentLevel += 1;
            //var cont = requestAttributes.t('ASK_PLAY_NEXT_LEVEL'); // user can progress to next level
            //attributes.drillStatus[attributes.drillStatusIndex].drill.level += 1; //wrong wrong wrong
            attributes.skillState = states.ENDOFLEVEL;
        }
    } else {
        speechOutput = requestAttributes.t('ASK_REPLAY_LEVEL', attributes.drillName, attributes.currentLevel, attributes.levelScore, QUESTIONS.length);
        attributes.skillState = states.REPLAYLEVEL;
        //var cont = requestAttributes.t('ASK_PLAY_NEXT_LEVEL'); // sorry but you need 100% to progress
    }

    // attributes.percentScore will get saved in the calling function
    attributes.percentScore = percentScore;

    //console.log('setting session attrs with attributes.drillStatus[0].drill.level=' + attributes.drillStatus[0].drill.level);
    handlerInput.attributesManager.setSessionAttributes(attributes);

    //return speechOutput;
    return speechOutput;
}

const HelpHandler = {
    canHandle(handlerInput) {
        console.log('Inside HelpHandler');
        const request = handlerInput.requestEnvelope.request;
        return request.type === 'IntentRequest' &&
            request.intent.name === 'AMAZON.HelpIntent';
    },
    handle(handlerInput) {
        console.log('Inside HelpHandler - handle');
        //const attributes = handlerInput.attributesManager.getSessionAttributes();
        const requestAttributes = handlerInput.attributesManager.getRequestAttributes();

        /*
        if (attributes.skillState === states.QUIZ) {
            // if the user asked for help in the middle of a quiz tag the last question on to the end of the help text
            speechOutput = requestAttributes.t('MULTI_CHOICE_HELP_MSG') + lastQuestionAsked;
        } else if (attributes.skillState === states.END) {
            // if the user asked for help at the end of the game give them a short message
            speechOutput = requestAttributes.t('NEW_TEST_MESSAGE');
        } else {
            speechOutput = requestAttributes.t('HELP_MESSAGE_LONG');
        }
        */
        speechOutput = requestAttributes.t('HELP_MESSAGE_LONG', ISPHelp.getSpeakableListOfDrills(drills), 'name of current drill');
        repromptOutput = requestAttributes.t('HELP_MESSAGE_SHORT');
        return handlerInput.responseBuilder
            .speak(speechOutput)
            .reprompt(requestAttributes.t('HELP_MESSAGE_SHORT'))
            .getResponse();
    },
};

const ExitHandler = {
    canHandle(handlerInput) {
        console.log('Inside ExitHandler');
        const request = handlerInput.requestEnvelope.request;

        return request.type === 'IntentRequest' && (
            request.intent.name === 'AMAZON.StopIntent' ||
            request.intent.name === 'AMAZON.PauseIntent' ||
            request.intent.name === 'AMAZON.CancelIntent'
        );
    },
    async handle(handlerInput) {
        console.log('Handling Exit');

        const attributes = handlerInput.attributesManager.getSessionAttributes();
        //const dbattributes = await handlerInput.attributesManager.getPersistentAttributes(); // <--dynamodb

        //dbattributes.invocations = attributes.invocations;
        //handlerInput.attributesManager.setPersistentAttributes(dbattributes);
        //await handlerInput.attributesManager.savePersistentAttributes();
        // tell user progress has been saved
        return exitSkill(handlerInput);
    },
};

function exitSkill(handlerInput) {
    const response = handlerInput.responseBuilder;
    //const attributes = handlerInput.attributesManager.getSessionAttributes();
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();

    speechOutput = '<audio src="soundbank://soundlibrary/ui/gameshow/amzn_ui_sfx_gameshow_outro_01"/>' + '<break time="1s"/>' + requestAttributes.t('BYE_YALL');
    response.withShouldEndSession(true);

    // Display rotating circle for devices with displays
    data.bodyTemplate7Data.video.type = 'outro'; // not working!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

    // if supports screen
    return handlerInput.responseBuilder
        .speak(speechOutput)
        //.reprompt(reprompt)
        .addDirective({
            type: 'Alexa.Presentation.APL.RenderDocument',
            version: '1.1',
            document: template,
            datasources: data
        })
        .getResponse();

}

function makeUpsell(preUpsellMessage, purchasableProduct, handlerInput) {
    //console.log('MAKING UPSELL WITH');
    console.log(purchasableProduct);
    //console.log('::' + purchasableProducts[0].productId + ':' + purchasableProducts[0].summary);
    //const attributes = handlerInput.attributesManager.getSessionAttributes();
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    let upsellMessage = `${preUpsellMessage} ${purchasableProduct.summary}. ${requestAttributes.t('RANDOM_LEARN_MORE_PROMPT', purchasableProduct.name)}`;

    //console.log('productId TO SEND IS ');
    //console.log(purchasableProduct[0].productId);

    return handlerInput.responseBuilder
        .addDirective({
            type: 'Connections.SendRequest',
            name: 'Upsell',
            payload: {
                InSkillProduct: {
                    //productId: drillPackProduct[0].productId
                    productId: purchasableProduct.productId
                },
                'upsellMessage': upsellMessage
            },
            token: 'correlationToken'
        })
        .getResponse();
}

const SessionEndedRequestHandler = {
    canHandle(handlerInput) {
        console.log('Inside SessionEndedRequestHandler');
        return handlerInput.requestEnvelope.request.type === 'SessionEndedRequest';
    },
    handle(handlerInput) {
        console.log(`Session ended with reason: ${JSON.stringify(handlerInput.requestEnvelope)}`);
        return handlerInput.responseBuilder.getResponse();
    },
};

const ErrorHandler = {
    canHandle() {
        console.log("Inside ErrorHandler");
        return true;
    },
    handle(handlerInput, error) {
        const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
        console.log(error);
        return handlerInput.responseBuilder
            .speak(requestAttributes.t('ERROR_1'))
            .reprompt(requestAttributes.t('ERROR_2'))
            .getResponse();
    },
};

const FallbackHandler = {
    canHandle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
        //console.log('Inside FallbackHandler and intent is ' + request.intent.name);
        return request.type === 'IntentRequest' &&
            request.intent.name === 'AMAZON.FallbackIntent';
    },
    handle(handlerInput) {
        console.log('Handling FallbackHandler');
        const attributes = handlerInput.attributesManager.getSessionAttributes();
        console.log('FallbackHandler attributes.skillState=' + attributes.skillState);
        const requestAttributes = handlerInput.attributesManager.getRequestAttributes();

        speechOutput = requestAttributes.t('FALLBACK_MESSAGE');
        repromptOutput = speechOutput;
        /*
                if (attributes.skillState === undefined) {
                    // Give the user some additional help if we got here before any questions have been asked
                    speechOutput += requestAttributes.t('HELP_MESSAGE_SHORT');
                    repromptOutput = requestAttributes.t('HELP_MESSAGE_SHORT');
                } else if (attributes.skillState === states.END) {
                    speechOutput += requestAttributes.t('HELP_MESSAGE_SHORT');
                    repromptOutput = requestAttributes.t('HELP_MESSAGE_SHORT');
                } else if (attributes.skillState === states.RESTART) {
                    speechOutput += requestAttributes.t('CONFIRM_RESTART_TEST');
                    repromptOutput = requestAttributes.t('CONFIRM_RESTART_TEST');
                } else if (attributes.skillState === states.QUIZ) {
                    // if the user gets here in the middle of a quiz reprompt with the last question
                    speechOutput += requestAttributes.t('OUT_OF_RANGE_MSG');
                    repromptOutput = lastQuestionAsked;
                }
        */
        return handlerInput.responseBuilder
            .speak(speechOutput)
            .reprompt(repromptOutput)
            .getResponse();
    },

};

//Respond to the utterance "what have I bought"
const PurchaseHistoryHandler = {
    canHandle(handlerInput) {
        return (
            handlerInput.requestEnvelope.request.type === 'IntentRequest' &&
            handlerInput.requestEnvelope.request.intent.name === 'PurchaseHistoryIntent'
        );
    },
    async handle(handlerInput) {

        const locale = handlerInput.requestEnvelope.request.locale;
        const monetizationClient = handlerInput.serviceClientFactory.getMonetizationServiceClient();
        const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
        const attributes = handlerInput.attributesManager.getSessionAttributes();

        console.log('OOOOOOOOOOOOOOOOOOOOOOOOOOOOO');
        console.log(attributes.entitledProducts);
        console.log(attributes.entitledProducts.length);
        console.log('OOOOOOOOOOOOOOOOOOOOOOOOOOOOO');

        if (attributes.entitledProducts.length > 0) { // please convert to requestattributes
            speechOutput = requestAttributes.t('PACKS_PURCHASED', ISPHelp.getSpeakableListOfProducts(attributes.entitledProducts)) +
                requestAttributes.t('WHAT_TO_DO_NEXT');
            repromptOutput = speechOutput;
        } else {
            // User hasn't purchased anything so can only play free content
            speechOutput = requestAttributes.t('NO_PRODUCTS_OWNED') + requestAttributes.t('WHAT_CAN_I_BUY');
            repromptOutput = requestAttributes.t('WHAT_CAN_I_BUY');
        }

        return handlerInput.responseBuilder
            .speak(speechOutput)
            .reprompt(repromptOutput)
            .getResponse();
    }
};

//Respond to the utterance "what can I buy"
const WhatCanIBuyHandler = {
    canHandle(handlerInput) {
        console.log('Inside WhatCanIBuyHandler');
        return (handlerInput.requestEnvelope.request.type === 'IntentRequest' &&
            handlerInput.requestEnvelope.request.intent.name === 'WhatCanIBuyIntent');
    },
    handle(handlerInput) {
        console.log('Handling WhatCanIBuyHandler');
        //Get the list of products available for in-skill purchase
        //const locale = handlerInput.requestEnvelope.request.locale;
        //const monetizationClient = handlerInput.serviceClientFactory.getMonetizationServiceClient();
        const attributes = handlerInput.attributesManager.getSessionAttributes();

        if (attributes.purchasableProducts.length > 0) { // please convert to requestattributes
            //One or more products are available for purchase. say the list of products
            // move to i18n
            speechOutput = `Products available for purchase at this time are, ${ISPHelp.getSpeakableListOfProducts(attributes.purchasableProducts)}. 
                            To learn more about a product, say, 'Tell me more about', followed by the product name. 
                            If you are ready to buy, say 'Buy', followed by the product name.`;
            //+ 'say repeat to hear this message again.'
            repromptOutput = 'I didn\'t catch that. What can I help you with?';
        } else {
            // no products are available for purchase. Ask if they would like to hear another greeting
            speechOutput = 'There are no products to offer to you right now. Sorry about that. Would you like to play one of your purchased packs?';
            // if user says yes to above give them a random purchased drill
            repromptOutput = 'I didn\'t catch that. What can I help you with?';
        }

        return handlerInput.responseBuilder
            .speak(speechOutput)
            .reprompt(repromptOutput)
            .getResponse();
    }
};

const IWantToPlayHandler = {
    canHandle(handlerInput) {
        console.log('Inside IWantToPlayHandler');
        return (handlerInput.requestEnvelope.request.type === 'IntentRequest' &&
            handlerInput.requestEnvelope.request.intent.name === 'IWantToPlayIntent');
    },
    handle(handlerInput) {
        console.log('Handling IWantToPlayHandler');
        const locale = handlerInput.requestEnvelope.request.locale;
        const monetizationClient = handlerInput.serviceClientFactory.getMonetizationServiceClient();
        const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
        const attributes = handlerInput.attributesManager.getSessionAttributes();

        //what if user gets here by bypassing launchrequest on first ever invocation?

        if (handlerInput.requestEnvelope.request.intent.slots.packToPlay.resolutions.resolutionsPerAuthority[0].status.code === 'ER_SUCCESS_NO_MATCH') {
            console.log('ER_SUCCESS_NO_MATCH');
            //whatever the user said didn't match a packType so don't proceed
            if (supportsAPL(handlerInput)) {
                //data.bodyTemplate7Data.video.type = 'intro';
                speechOutput = 'Sorry but i don\'t know that one!';
                repromptOutput = 'reprompt';
                return handlerInput.responseBuilder
                    .speak(speechOutput)
                    .reprompt(repromptOutput)
                    .addDirective({
                        type: 'Alexa.Presentation.APL.RenderDocument',
                        version: '1.1',
                        document: tempNoMatch,
                        datasources: dataNoMatch
                    })
                    .getResponse();
            }
            //return handlerInput.responseBuilder.getResponse();
            /*
            return handlerInput.responseBuilder
                .speak(requestAttributes.t('UNKNOWN_PACK_REQUESTED') + requestAttributes.t('WHAT_CAN_I_BUY'))
                .reprompt('i repeat no can play') // requires attention
                .getResponse();
            */
        }

        // No need to check enetitlement if free pack is requested
        let packRef = handlerInput.requestEnvelope.request.intent.slots.packToPlay.resolutions.resolutionsPerAuthority[0].values[0].value.id;
        if (packRef === freePackRef) {
            attributes.currentDrillRef = packRef; //
            return setupLevel(handlerInput);

        }

        // Let's see if the user is entitled to play the requested pack
        return monetizationClient.getInSkillProducts(locale).then((res) => {
            let packRef = handlerInput.requestEnvelope.request.intent.slots.packToPlay.resolutions.resolutionsPerAuthority[0].values[0].value.id;
            let product = res.inSkillProducts.filter(record => record.referenceName === packRef); //filter the reference name
            console.log('******************************************** the pack is ' + packRef);
            console.log(product);

            //if (ISPHelp.isEntitled(attributes.entitledProducts, product[0].referenceName)) {
            if (ISPHelp.isEntitled(attributes.entitledProducts, packRef)) {
                attributes.currentDrillRef = packRef;
                // get the level & status from drillstatus. If there is no drillsttaus record add one.
                let idx = getRefIndex(attributes.drillStatus, attributes.currentDrillRef);
                if (idx === undefined) {
                    let obj = {};
                    obj.drill = attributes.currentDrillRef;
                    obj.level = 1;
                    obj.completed = false;
                    attributes.drillStatus.push(JSON.parse(JSON.stringify(obj)));
                    attributes.currentLevel = 1;
                } else {
                    attributes.currentLevel = attributes.drillStatus[idx].level;
                }
                return setupLevel(handlerInput); // requires attention
            } else {

                console.log('START OF SENDING PRODUCT');
                console.log(product);
                console.log('END OF SENDING PRODUCT');

                return makeUpsell('You don\'t currently own the ' + product[0].name + ' pack.', product[0], handlerInput);
            }
        });
    }
};

const BuyPackIntentHandler = {
    canHandle(handlerInput) {
        console.log('inside BuyPackIntentHandler');

        return handlerInput.requestEnvelope.request.type === 'IntentRequest' &&
            handlerInput.requestEnvelope.request.intent.name === 'BuyPackIntent';
    },
    handle(handlerInput) {
        console.log('handling BuyPackIntentHandler');
        const locale = handlerInput.requestEnvelope.request.locale;
        const ms = handlerInput.serviceClientFactory.getMonetizationServiceClient();
        //const attributes = handlerInput.attributesManager.getSessionAttributes();

        //console.log('handlerInput.requestEnvelope.request.intent.slots.productCategory.value=' + handlerInput.requestEnvelope.request.intent.slots.productCategory.value);
        //console.log('handlerInput.requestEnvelope.request.intent.slots.productCategory.resolutions.resolutionsPerAuthority[0].values[0].value.id=' 
        //            + handlerInput.requestEnvelope.request.intent.slots.productCategory.resolutions.resolutionsPerAuthority[0].values[0].value.id);

        if (handlerInput.requestEnvelope.request.intent.slots.productCategory.resolutions.resolutionsPerAuthority[0].status.code === 'ER_SUCCESS_NO_MATCH') {
            //whatever the user said didn't match a packType so don't proceed
            return handlerInput.responseBuilder
                .speak('No match')
                .reprompt('i repeat no match')
                .getResponse();
        }

        if (handlerInput.requestEnvelope.request.intent.slots.productCategory.resolutions.resolutionsPerAuthority[0].values.length > 1) {
            //More than one match was returnd so let the user know which packs are available so they can try again
            return handlerInput.responseBuilder
                .speak('i don\'t know which one you want')
                .reprompt('sorry but i don\'t know which one you want')
                .getResponse();
        }

        //extract the pack's reference name from the request json
        let pack = handlerInput.requestEnvelope.request.intent.slots.productCategory.resolutions.resolutionsPerAuthority[0].values[0].value.id;
        console.log('PACK OUTSIDE getInSkillProducts BLOCK=' + pack);

        if (pack === freePackRef) {
            // i'm outa here!
            let qta = setupLevel(handlerInput);
            speechOutput = 'no buy required. ' + qta;
            repromptOutput = qta;
            return handlerInput.responseBuilder
                .speak(speechOutput)
                .reprompt(repromptOutput)
                .getResponse();
        }
        return ms.getInSkillProducts(locale).then(function (res) {
            //console.log('>>>>>>>>>>>>>>>>>>>drills[attributes.drill][packName]=' + drills[attributes.drill]['packName']);
            //console.log(handlerInput.requestEnvelope.request.intent.slots.potty.value);
            //console.log(attributes.purchasableProducts);
            console.log('PACK INSIDE getInSkillProducts BLOCK=' + pack);
            let product = res.inSkillProducts.filter(record => record.referenceName === pack); //filter the reference name
            console.log('START PRODUCT');
            console.log(product);
            console.log('END PRODUCT');

            return handlerInput.responseBuilder
                .addDirective({
                    'type': 'Connections.SendRequest',
                    'name': 'Buy',
                    'payload': {
                        'InSkillProduct': {
                            'productId': product[0].productId
                        }
                    },
                    'token': 'correlationToken'
                })
                .getResponse();
        });

    }
};

const RefundPackIntentHandler = {
    canHandle(handlerInput) {
        console.log('inside RefundPackIntentHandler');

        return handlerInput.requestEnvelope.request.type === 'IntentRequest' &&
            handlerInput.requestEnvelope.request.intent.name === 'RefundPackIntent';
    },
    handle(handlerInput) {
        console.log('handling RefundPackIntentHandler');
        // Inform the user about what products are available for purchase
        const locale = handlerInput.requestEnvelope.request.locale;
        const ms = handlerInput.serviceClientFactory.getMonetizationServiceClient();
        //const attributes = handlerInput.attributesManager.getSessionAttributes();

        //console.log('handlerInput.requestEnvelope.request.intent.slots.productCategory.value=' + handlerInput.requestEnvelope.request.intent.slots.productCategory.value);
        //console.log('handlerInput.requestEnvelope.request.intent.slots.productCategory.resolutions.resolutionsPerAuthority[0].values[0].value.id=' 
        //            + handlerInput.requestEnvelope.request.intent.slots.productCategory.resolutions.resolutionsPerAuthority[0].values[0].value.id);

        if (handlerInput.requestEnvelope.request.intent.slots.packToReturn.resolutions.resolutionsPerAuthority[0].status.code === 'ER_SUCCESS_NO_MATCH') {
            //whatever the user said didn't match a packType so don't proceed
            return handlerInput.responseBuilder
                .speak('No match')
                .reprompt('i repeat no match')
                .getResponse();
        }

        if (handlerInput.requestEnvelope.request.intent.slots.packToReturn.resolutions.resolutionsPerAuthority[0].values.length > 1) {
            //More than one match was returnd so let the user know which packs are available so they can try again
            return handlerInput.responseBuilder
                .speak('i don\'t know which one you want')
                .reprompt('sorry but i don\'t know which one you want')
                .getResponse();
        }

        //extract the pack's reference name from the request json
        let pack = handlerInput.requestEnvelope.request.intent.slots.packToReturn.resolutions.resolutionsPerAuthority[0].values[0].value.id;

        return ms.getInSkillProducts(locale).then(function (res) {
            //console.log('>>>>>>>>>>>>>>>>>>>drills[attributes.drill][packName]=' + drills[attributes.drill]['packName']);
            //console.log(handlerInput.requestEnvelope.request.intent.slots.potty.value);
            //console.log(attributes.purchasableProducts);
            let product = res.inSkillProducts.filter(record => record.referenceName === pack); //filter the reference name
            console.log('START REFUND PRODUCT');
            console.log(product);
            console.log('END REFUND PRODUCT');

            return handlerInput.responseBuilder
                .addDirective({
                    'type': 'Connections.SendRequest',
                    'name': 'Cancel',
                    'payload': {
                        'InSkillProduct': {
                            'productId': product[0].productId
                        }
                    },
                    'token': 'correlationToken'
                })
                .getResponse();
        });

    }
};

const BuyAndUpsellResponseHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'Connections.Response' &&
            (handlerInput.requestEnvelope.request.name === 'Buy' ||
                handlerInput.requestEnvelope.request.name === 'Upsell');
    },
    handle(handlerInput) {
        console.log('IN: BuyResponseHandler.handle');
        const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
        const locale = handlerInput.requestEnvelope.request.locale;
        const ms = handlerInput.serviceClientFactory.getMonetizationServiceClient();
        //const DEFAULT_REPROMPT = ' What would you like to do next?</voice>';

        return ms.getInSkillProducts(locale).then(async function handlePurchaseResponse(res) {

            if (handlerInput.requestEnvelope.request.status.code === '200') {
                let speechOutput = "";
                const attributes = handlerInput.attributesManager.getSessionAttributes();

                console.log('{{{{{{{{}}}}}}}}}}');
                console.log(handlerInput.requestEnvelope.request.payload);
                console.log('{{{{{{{{}}}}}}}}}}');

                //let product = res.inSkillProducts.filter(record => record.productId == handlerInput.requestEnvelope.request.payload.productId); //filter the product ID

                //console.log('handlerInput.requestEnvelope.request.payload.productid=' + handlerInput.requestEnvelope.request.payload.productId);
                switch (handlerInput.requestEnvelope.request.payload.purchaseResult) {
                    case 'ACCEPTED':
                        let newProd = attributes.entitledProducts.filter(function (drill) {
                            return drill.productId === handlerInput.requestEnvelope.request.payload.productId
                        });
                        let obj = {};
                        obj.drill = newProd[0].referenceName;
                        obj.level = 1;
                        console.log('C - setting completed to false');

                        obj.completed = false;
                        console.log('setting ' + obj.drill + ' to false ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++');
                        console.log(JSON.stringify(attributes.drillStatus));
                        attributes.drillStatus.push(JSON.parse(JSON.stringify(obj)));
                        console.log(JSON.stringify(attributes.drillStatus));

                        attributes.currentDrillRef = newProd[0].referenceName;
                        attributes.currentLevel = 1;
                        attributes.level = 0; // used as array index
                        attributes.drillName = getDrillName(attributes.currentDrillRef);
                        attributes.drillLevels = getNumDrillLevels(attributes.currentDrillRef);
                        attributes.levelData = getLevelData(attributes.currentDrillRef, attributes.level);
                        attributes.skillState = states.STARTLEVEL;

                        console.log('referenceName of newly purchased product:');
                        console.log(newProd[0]);
                        return setupLevel(handlerInput); // requires attention
                    case 'DECLINED': // should really only be able to get here by saying no to the buy offer. how do other skills deal with this?
                        let declinedPack = res.inSkillProducts.filter(record => record.productId == handlerInput.requestEnvelope.request.payload.productId); //filter the product ID
                        //console.log('~~~');
                        //console.log(declinedPack);
                        speechOutput = requestAttributes.t('PACK_DECLINED_MSG1') + requestAttributes.t('PACK_DECLINED_MSG2', declinedPack[0].name);
                        break;
                    case 'ALREADY_PURCHASED':
                        speechOutput = requestAttributes.t('ALREADY_OWNED', attributes.currentDrillRef) + requestAttributes.t('WHAT_TO_DO_NEXT');
                        break;
                    default:
                        speechOutput = "Something unexpected happened, but thanks for your interest in this skill. ";
                        break;
                }
                return handlerInput.responseBuilder
                    .speak(speechOutput)
                    .reprompt(speechOutput)
                    .getResponse();
            }

            // Something failed.
            console.log(`Connections.Response indicated failure. error: ${handlerInput.requestEnvelope.request.status.message}`);

            return handlerInput.responseBuilder
                .speak('There was an error handling your purchase request. Please try again or contact us for help. Details have been sent to the skill card.')
                .getResponse();
        });
    },
};

const CancelProductResponseHandler = {
    canHandle(handlerInput) {
        return (
            handlerInput.requestEnvelope.request.type === 'Connections.Response' &&
            handlerInput.requestEnvelope.request.name === 'Cancel'
        );
    },
    handle(handlerInput) {
        const locale = handlerInput.requestEnvelope.request.locale;
        const monetizationClient = handlerInput.serviceClientFactory.getMonetizationServiceClient();
        const productId = handlerInput.requestEnvelope.request.payload.productId;
        const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
        let speechText, repromptOutput;

        return monetizationClient.getInSkillProducts(locale).then((res) => {
            const product = res.inSkillProducts.filter(
                record => record.productId === productId,
            );

            console.log(
                `PRODUCT = ${JSON.stringify(product)}`,
            );

            if (handlerInput.requestEnvelope.request.status.code === '200') {
                // Alexa handles the speech response immediately following the cancellation request.
                // It then passes the control to our CancelProductResponseHandler() along with the status code (ACCEPTED, DECLINED, NOT_ENTITLED)
                // We use the status code to stitch additional speech at the end of Alexa's cancellation response.
                if (handlerInput.requestEnvelope.request.payload.purchaseResult === 'ACCEPTED') {
                    // The cancellation confirmation response is handled by Alexa's Purchase Experience Flow.
                    speechText = requestAttributes.t('WHAT_TO_DO_NEXT');
                    repromptOutput = requestAttributes.t('WHAT_TO_DO_NEXT');
                } else if (handlerInput.requestEnvelope.request.payload.purchaseResult === 'DECLINED') {
                    speechText = requestAttributes.t('WHAT_TO_DO_NEXT');
                    repromptOutput = requestAttributes.t('WHAT_TO_DO_NEXT');;
                } else if (handlerInput.requestEnvelope.request.payload.purchaseResult === 'NOT_ENTITLED') {
                    // No subscription to cancel.
                    // The "No subscription to cancel" response is handled by Alexa's Purchase Experience Flow.
                    // Simply add to that with getRandomYesNoQuestion()
                    speechText = `${requestAttributes.t('WHAT_TO_DO_NEXT')}`;
                    repromptOutput = requestAttributes.t('WHAT_TO_DO_NEXT');
                }
                return handlerInput.responseBuilder
                    .speak(speechText)
                    .reprompt(repromptOutput)
                    .getResponse();
            }
            // Something failed.
            console.log(`Connections.Response indicated failure. error: ${handlerInput.requestEnvelope.request.status.message}`);

            return handlerInput.responseBuilder
                .speak('There was an error handling your purchase request. Please try again or contact us for help.')
                .getResponse();
        });
    },
};

const TellMeMoreAboutPackIntentHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest' &&
            handlerInput.requestEnvelope.request.intent.name === 'TellMeMoreAboutPackIntent';
    },
    handle(handlerInput) {
        const locale = handlerInput.requestEnvelope.request.locale;
        const monetizationClient = handlerInput.serviceClientFactory.getMonetizationServiceClient();
        //const attributes = handlerInput.attributesManager.getSessionAttributes();

        //extract the pack's reference name from the request json
        let pack = handlerInput.requestEnvelope.request.intent.slots.productCategory.resolutions.resolutionsPerAuthority[0].values[0].value.id;

        return monetizationClient.getInSkillProducts(locale).then((res) => {
            let product = res.inSkillProducts.filter(record => record.referenceName === pack); //filter the reference name

            if (ISPHelp.isEntitled(product)) {
                const speechText = `Good News! You already have this Pack. You can say tell me more about blah for more information`;
                const repromptOutput = `reprompt`;

                return handlerInput.responseBuilder
                    .speak(speechText)
                    .reprompt(repromptOutput)
                    .getResponse();
            }
            // Make the upsell
            console.log('START OF SENDING PRODUCT');
            console.log(product);
            console.log('END OF SENDING PRODUCT');

            return makeUpsell('Sure.', product[0], handlerInput);

        });
    },
};

/* HELPER FUNCTIONS */

// Does the device support APL?
function supportsAPL(handlerInput) {
    const supportedInterfaces = handlerInput.requestEnvelope.context
        .System.device.supportedInterfaces;
    const aplInterface = supportedInterfaces['Alexa.Presentation.APL'];
    return aplInterface != null && aplInterface !== undefined;
}

const LocalizationInterceptor = {
    process(handlerInput) {
        const localizationClient = i18n.use(sprintf).init({
            lng: handlerInput.requestEnvelope.request.locale,
            fallbackLng: 'en', // fallback to EN if locale doesn't exist
            resources: languageStrings
        });

        localizationClient.localize = function () {
            const args = arguments;
            let values = [];

            for (var i = 1; i < args.length; i++) {
                values.push(args[i]);
            }
            const value = i18n.t(args[0], {
                returnObjects: true,
                postProcess: 'sprintf',
                sprintf: values
            });

            if (Array.isArray(value)) {
                return value[Math.floor(Math.random() * value.length)];
            } else {
                return value;
            }
        }

        const attributes = handlerInput.attributesManager.getRequestAttributes();
        attributes.t = function (...args) { // pass on arguments to the localizationClient
            return localizationClient.localize(...args);
        };
    },
};

// https://developer.amazon.com/blogs/alexa/post/75ee61df-8365-44bb-b28f-e708000891ad/how-to-use-interceptors-to-simplify-handler-code-and-cache-product-and-purchase-information-in-monetized-alexa-skills
const loadISPDataInterceptor = {
    async process(handlerInput) {
        if (handlerInput.requestEnvelope.session.new === true) {
            // new session, check to see what products are already owned.
            try {
                const locale = handlerInput.requestEnvelope.request.locale;
                const ms = handlerInput.serviceClientFactory.getMonetizationServiceClient();
                const result = await ms.getInSkillProducts(locale);
                const entitledProducts = ISPHelp.getAllEntitledProducts(result.inSkillProducts);
                const purchasableProducts = ISPHelp.getAllpurchasableProducts(result.inSkillProducts);
                console.log(purchasableProducts);
                const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
                sessionAttributes.entitledProducts = entitledProducts;
                sessionAttributes.purchasableProducts = purchasableProducts;
                handlerInput.attributesManager.setSessionAttributes(sessionAttributes);
            } catch (error) {
                console.log(`Error calling InSkillProducts API: ${error}`);
            }
        }
    },
};

// This request interceptor with each new session loads all global persistent attributes
// into the session attributes and increments a launch counter
const PersistenceRequestInterceptor = {
    process(handlerInput) {
        if (handlerInput.requestEnvelope.session.new === true) {
            return new Promise((resolve, reject) => {
                handlerInput.attributesManager.getPersistentAttributes()
                    .then((persistentAttributes) => {
                        persistentAttributes = persistentAttributes || {};
                        //console.log('persistentAttributes.launchCount=' + persistentAttributes.launchCount);
                        if (!persistentAttributes.launchCount) { // first ever launch
                            persistentAttributes.skillState = states.FIRSTLAUNCH;
                            persistentAttributes.launchCount = 0;
                            persistentAttributes.drillStatus = []; //initialize array
                            //addNewDrillStatus(freePackRef);
                            let obj = {};
                            obj.drill = freePackRef;
                            obj.level = 1;
                            console.log('D - setting completed to false');

                            obj.completed = false;
                            persistentAttributes.drillStatus.push(JSON.parse(JSON.stringify(obj)));
                            persistentAttributes.currentDrillRef = freePackRef; // all new users start with the free perfect intervals drill
                            persistentAttributes.currentLevel = 1;
                            persistentAttributes.very1st = true;
                        }
                        persistentAttributes.level = persistentAttributes.currentLevel - 1;
                        persistentAttributes.drillName = getDrillName(persistentAttributes.currentDrillRef);
                        persistentAttributes.drillLevels = getNumDrillLevels(persistentAttributes.currentDrillRef);
                        persistentAttributes.levelData = getLevelData(persistentAttributes.currentDrillRef, persistentAttributes.level);
                        persistentAttributes.launchCount += 1;
                        console.log('GET ######################################' + persistentAttributes.levelData);
                        handlerInput.attributesManager.setSessionAttributes(persistentAttributes);
                        resolve();
                    })
                    .catch((err) => {
                        reject(err);
                    });
            });
        } // end session['new']
    }
};

// This response interceptor stores all session attributes into global persistent attributes
// when the session ends and it stores the skill last used timestamp
const PersistenceResponseInterceptor = {
    process(handlerInput, response) {
        console.log('????????????????????????????????????????????????????????????????????????????????????????');
        console.log("RESPONSE+++++++++" + JSON.stringify(handlerInput.responseBuilder.getResponse(), null, 2));
        console.log('????????????????????????????????????????????????????????????????????????????????????????');

        //const ses = (typeof responseOutput.shouldEndSession === "undefined" ? true : responseOutput.shouldEndSession); 
        //if(ses || handlerInput.requestEnvelope.request.type === 'SessionEndedRequest') { // skill was stopped or timed out
        const r = handlerInput.requestEnvelope.request;
        let sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        //console.log('PersistenceResponseInterceptor sessionAttributes.skillState=' + sessionAttributes.skillState);
        console.log('r.......................................................................................');
        console.log(r);
        console.log('r---------------------------------------------------------------------------------------');
        //console.log(sessionAttributes.drillStatus[0].drill.level);
        //console.log('........................................................................................');

        if ((r.type === 'SessionEndedRequest') ||
            (r.type === 'IntentRequest' && r.intent.name === "AMAZON.StopIntent") || // skill was stopped or timed out
                sessionAttributes.skillState === states.EXITSKILL ||
                sessionAttributes.very1st === true) {

            sessionAttributes.very1st = false;
            sessionAttributes.lastUseTimestamp = new Date(handlerInput.requestEnvelope.request.timestamp).getTime();
            console.log('SET ######################################' + sessionAttributes.launchCount);
            //handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

            handlerInput.attributesManager.setPersistentAttributes(sessionAttributes);
            return new Promise((resolve, reject) => {
                handlerInput.attributesManager.savePersistentAttributes()
                    .then(() => {
                        resolve();
                    })
                    .catch((err) => {
                        reject(err);
                    });
            });
        }
    }
};

function getNextPurchasableProduct(handlerInput) {
    const attributes = handlerInput.attributesManager.getSessionAttributes();

    // When the end of a drill is reached get the next purchasable product for upsell
    //console.log('[*********************************************************]');
    //console.log(purchasableProducts);
    //console.log('[*********************************************************]');

    if (attributes.purchasableProducts.length > 0) {
        return attributes.purchasableProducts[0];
    } else {
        return 'No packs available for purchase';
    }

}

function getDrillName(drillref) {

    // use the drill ref to get the drill name
    let arr = Object.keys(drills);
    let DRILLREF = arr[arr.indexOf(drillref)]; //e.g. key-signatures
    return drills[DRILLREF].name;

}

function getNumDrillLevels(drillref) {

    // use the drill ref to get the number of levels
    let arr = Object.keys(drills);
    let DRILLREF = arr[arr.indexOf(drillref)]; //e.g. key-signatures
    return drills[DRILLREF].levels.length;
}

function getLevelData(drillref, level) {

    // use the drill ref to get the data for the current level
    let arr = Object.keys(drills);
    let DRILLREF = arr[arr.indexOf(drillref)]; //e.g. key-signatures
    console.log('LLLLLLLLLLLLLLLLLL');
    console.log(drills);
    console.log(level);
    console.log(drills[DRILLREF].levels);
    console.log(drills[DRILLREF].levels[level]);
    return drills[DRILLREF].levels[level];

}

function getRefIndex(drillstatus, drillref) {
    // get the index of the drill in drillstatus
    for (var key in drillstatus) {
        var value = drillstatus[key];
        if (value.drill === drillref)
            // console.log(key + " = " + JSON.stringify(value));
            return key;
    }
}


// ********************* LOG INTERCEPTORS ********************
const LogRequestInterceptor = {
    process(handlerInput) {
        console.log(`REQUEST ENVELOPE = ${JSON.stringify(handlerInput.requestEnvelope)}`);
    },
};
const LogResponseInterceptor = {
    process(handlerInput) {
        console.log("=============================== START LOG REQUEST =======================================");
        console.log(JSON.stringify(handlerInput.requestEnvelope, null, 2));
        console.log("=============================== end LOG REQUEST =======================================");
    },
};
// ********************* END OF LOG INTERCEPTORS ********************

var skillBuilder = Alexa.SkillBuilders.custom();

/* LAMBDA SETUP */
exports.handler = skillBuilder
    .addRequestHandlers(
        LaunchRequestHandler,
        BuyPackIntentHandler,
        IWantToPlayHandler,
        YesIntentHandler,
        NoIntentHandler,
        PurchaseHistoryHandler,
        WhatCanIBuyHandler,
        BuyAndUpsellResponseHandler,
        CancelProductResponseHandler,
        TellMeMoreAboutPackIntentHandler,
        RefundPackIntentHandler,
        AnswerHandler,
        //AnswerHandlerNumeric,
        HelpHandler,
        ExitHandler,
        WhatIsTheAnswerHandler,
        FallbackHandler,
        SessionEndedRequestHandler
    )
    .withPersistenceAdapter(persistenceAdapter) // <-- dynamodb
    .addRequestInterceptors(PersistenceRequestInterceptor)
    .addResponseInterceptors(PersistenceResponseInterceptor)
    .addRequestInterceptors(LocalizationInterceptor)
    .addRequestInterceptors(loadISPDataInterceptor)
    //.addRequestInterceptors(LogRequestInterceptor)
    //.addResponseInterceptors(LogResponseInterceptor)
    .addErrorHandlers(ErrorHandler)
    .withApiClient(new Alexa.DefaultApiClient()) // required for getMonetizationServiceClient
    .lambda();