/* eslint-disable  func-names */
/* eslint-disable  no-console */
/* eslint-disable  no-restricted-syntax */

//const Alexa = require('ask-sdk-core');
const Alexa = require('ask-sdk');
const i18n = require('i18next');
const sprintf = require('i18next-sprintf-postprocessor');
var util = require('./utils');
var asset = require('./assets');

const languageStrings = {
    'en' : require('./i18n/en'),
    'en-GB' : require('./i18n/en-GB'),
    'it' : require('./i18n/it')
}
const states = {
    START: '_START',
    RESTART: '_RESTART',
    QUIZ: '_QUIZ',
    END: '_END',
    SETUP: '_SETUP',
};

//http://whatdidilearn.info/2018/09/16/how-to-keep-state-between-sessions-in-alexa-skill.html
const { DynamoDbPersistenceAdapter } = require('ask-sdk-dynamodb-persistence-adapter');
const tableName = 'circle-of-fifths';
const partitionKeyName = 'COFUserID';
const persistenceAdapter = new DynamoDbPersistenceAdapter({
  tableName,
  partitionKeyName,
  createTable: false
});

// move this to en.js
//const validQuiz = ['fourths', 'fifths', 'mixed', '4ths', '4th', '5ths', '5th', 'pick', 'any', 'choose', 'either', 'mix', 'mixture', 'start'];
var utteredAnswer = '';

// Key,4th,5th,sharps,flats,relative minor
var circleKeys_ = [
    ['c', 'f', 'g', '0', '0', 'a'],
    ['f', 'b flat', 'c', '0', '1', 'd'],
    ['b flat', 'e flat', 'f', '0', '2', 'g'],
    ['e flat', 'a flat', 'b flat', '0', '3', 'c'],
    ['a flat', 'E1A', 'e flat', '0', '4','f'],
    ['E1A', 'E2A', 'a flat', 'E1S', 'E1F', 'E1R'], //E1S=sharps, E1F=flats, E1R=relative minor
    ['E2A', 'E3A', 'E1A', 'E2S', 'E2F', 'E2R'], //E2S=sharps, E2F=flats, E2R=relative minor
    ['E3A', 'e', 'E2A', 'E3S', 'E3F', 'E3R'], //E3S=sharps, E3F=flats, E3R=relative minor
    ['e', 'a', 'E3A', '4', '0', 'c sharp'],
    ['a', 'd', 'e', '3', '0', 'f sharp'],
    ['d', 'g', 'a', '2', '0', 'b'],
    ['g', 'c', 'd', '1', '0', 'e'],
];

var fifteenKeys = [];
var circleKeys = [];
var numQuestions = 0; // value will be set from dynamodb
var cardInfoArray = [];
var keyQuestionArray = []; // Array to hold the key included in the question e.g. A Flat, G Sharp.
var questionArray = [];
var multiChoiceArray = [];
var relAnswers = [];
var lastQuestionAsked = '';
var speechOutput = '';

var date = new Date(); // date object to be used for workng out period of day. i.e. morning, afternoon, evening for en-GB only

/* INTENT HANDLERS */
const LaunchRequestHandler = {
    canHandle(handlerInput) {
        //console.log('Inside LaunchRequestHandler ++++++++++++++++');
        return handlerInput.requestEnvelope.request.type === 'LaunchRequest';
    },
    async handle(handlerInput) {
        //console.log('Handling LaunchRequest');

        const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
/*
        const dbattributes = await handlerInput.attributesManager.getPersistentAttributes(); // <--dynamodb
        if (typeof dbattributes.questionsPerTest === 'undefined') {
            dbattributes.questionsPerTest = 6; // Set to this value if no record exists
            handlerInput.attributesManager.setPersistentAttributes(dbattributes);
            await handlerInput.attributesManager.savePersistentAttributes();
        }
        numQuestions = dbattributes.questionsPerTest;
*/
        // only the en-GB language file has the %s placeholder so hopefully periodofday() will be ignored for everyone else
        //var welcomePrefix = requestAttributes.t('WELCOME_G') + util.periodOfDay(date.getHours()) + requestAttributes.t('WELCOME_A');
        var welcomePrefix = ''; // probbaly will abandon good morning, good evening etc.
        //console.log('welcomePrefix=' + welcomePrefix);
        speechOutput = requestAttributes.t('WELCOME_MESSAGE_1', welcomePrefix) + requestAttributes.t('PICK_A_TEST_MSG');
        var reprompt = requestAttributes.t('HELP_MESSAGE_SHORT');

        return showSkillIntro(speechOutput, reprompt, handlerInput);
    },
};

const QuizHandler = {
    canHandle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
        //console.log('Inside QuizHandler');
        //console.log(JSON.stringify(request));
        return request.type === "IntentRequest" && request.intent.name === "QuizIntent";
    },
    handle(handlerInput) {
        //console.log("Inside QuizHandler - handle");
        //const attributes = handlerInput.attributesManager.getSessionAttributes();
        const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
        const response = handlerInput.responseBuilder;

        var mySlot = '';
        var speechOutput = '';
        var repromptOutput = '';

        //console.log('handlerInput.requestEnvelope.request.intent.slots.TEST_TYPE.value=' + handlerInput.requestEnvelope.request.intent.slots.TEST_TYPE.value);
        mySlot = handlerInput.requestEnvelope.request.intent.slots.TEST_TYPE.value;
        var ans = languageStrings.en.translation['VALID_TEST'].includes(mySlot);  // will not work for non english languages
        //var ans = validQuiz.includes(mySlot);
        if (ans) {
            //console.log('SETTING UP QUIZ');
            return setupQuiz(handlerInput, mySlot);
        } else {
            // Can get to this point by either a bad quiz type or a bad multi choice answer
            //On second thought's this code may never be executed as it looks like this is caught by the fallback intent
            speechOutput = requestAttributes.t('UNKNOWN_TEST_NAME');
            repromptOutput = requestAttributes.t('HELP_MESSAGE_SHORT');
        }

        return response.speak(speechOutput)
            .reprompt(repromptOutput)
            .getResponse();
    },
};

const QuizAnswerHandler = {
    canHandle(handlerInput) {
        //console.log("Inside QuizAnswerHandler");
        const attributes = handlerInput.attributesManager.getSessionAttributes();
        //console.log('attributes.skillState=' + attributes.skillState);
        const request = handlerInput.requestEnvelope.request;
        return (request.type === 'IntentRequest' &&
            request.intent.name === 'AnswerIntent' && attributes.skillState !== states.SETUP);
    },
    handle(handlerInput) {
        //console.log("Inside QuizAnswerHandler - handle");
        const response = handlerInput.responseBuilder;
        const attributes = handlerInput.attributesManager.getSessionAttributes();
        const requestAttributes = handlerInput.attributesManager.getRequestAttributes();

        if (attributes.skillState === states.END) {
            // game has ended but user replied with a number when asked to say fourths,fifths or random
            speechOutput = requestAttributes.t('ASK_PLAY_AGAIN');
            repromptOutput = requestAttributes.t('ASK_PLAY_AGAIN');
        } else if (attributes.skillState === states.RESTART) {
            //console.log('attributes.skillState=' + attributes.skillState);
            speechOutput = requestAttributes.t('FALLBACK_MESSAGE');
            repromptOutput = requestAttributes.t('FALLBACK_MESSAGE');
        } else if (attributes.skillState === undefined) {
            // user has said a number instead of a test name
            speechOutput = requestAttributes.t('PICK_A_TEST_MSG');
            repromptOutput = requestAttributes.t('PICK_A_TEST_MSG') + requestAttributes.t('FALLBACK_MESSAGE');
        } else {
            repromptOutput = lastQuestionAsked;
            speechOutput = HandleTheAnswer(handlerInput, handlerInput.requestEnvelope.request.intent.slots.ANSWER.value);
            //console.log('speechOutput=' + speechOutput);
        }
        
        if (supportsDisplay(handlerInput)) {
            if (attributes.skillState === states.END) {
                return gameOverWithDisplay(handlerInput, speechOutput);
            }
        }

        if (attributes.skillState === states.END) {
            return response.speak(speechOutput)
            .reprompt(repromptOutput)
            .withSimpleCard(requestAttributes.t('SKILL_NAME') + requestAttributes.t('SUMMARY_TXT'), printCardInfo(handlerInput)) // print list of QandA in the form 'What is D the fourth of?' You: A, Ans: A
            .getResponse();
        } else {
            return response.speak(speechOutput)
            .reprompt(repromptOutput)
            .getResponse();
        }
            
    },
};

const SetNumberOfQuestionsHandler = {
    canHandle(handlerInput) {
        // Use Answerintent intent as it is triggered by a number
        //console.log("Inside SetNumberOfQuestionsHandler");
        const attributes = handlerInput.attributesManager.getSessionAttributes();
        //console.log('attributes.skillState=' + attributes.skillState);
        const request = handlerInput.requestEnvelope.request;
        return (request.type === 'IntentRequest' &&
            request.intent.name === 'AnswerIntent' && attributes.skillState === states.SETUP);
    },
    async handle(handlerInput) {
        //console.log('Handling SetNumberOfQuestionsHandler');

        const response = handlerInput.responseBuilder;
        const requestAttributes = handlerInput.attributesManager.getRequestAttributes();

        const NUM = Number(handlerInput.requestEnvelope.request.intent.slots.ANSWER.value);
        if (NUM < 1 || NUM > 12) { 
            speechOutput = requestAttributes.t('OUT_OF_RANGE_MSG', 12);
            repromptOutput = requestAttributes.t('OUT_OF_RANGE_MSG', 12);
        } else {
            const dbattributes = await handlerInput.attributesManager.getPersistentAttributes(); // <--dynamodb
            dbattributes.questionsPerTest = NUM;
            handlerInput.attributesManager.setPersistentAttributes(dbattributes);
            await handlerInput.attributesManager.savePersistentAttributes();
            speechOutput = requestAttributes.t('NUM_QUESTIONS_CHANGED', NUM + '. ') + requestAttributes.t('PICK_A_TEST_MSG');
            repromptOutput = requestAttributes.t('PICK_A_TEST_MSG');
        }  
        return response.speak(speechOutput)
            .reprompt(repromptOutput)
            .getResponse();
    },
};

function printCardInfo(handlerInput) {
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    var cardInfo = requestAttributes.t('CARD_INFO_1');

    for (i = 0, len = cardInfoArray.length; i < len; i++) {
        cardInfo += cardInfoArray[i] + '\n';
    }
    return cardInfo;
}

function HandleTheAnswer(handlerInput, answerIn) {

    //console.log('Handling the answer');
    const attributes = handlerInput.attributesManager.getSessionAttributes();
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();

    var speechOutput = '';

    utteredAnswer = answerIn;
    if (utteredAnswer < 1 || utteredAnswer > languageStrings.en.translation.CHOICES) {
        //console.log('uttered ' + utteredAnswer + ' isNaN(utteredAnswer)=' + isNaN(utteredAnswer));
        //console.log(utteredAnswer + ' is a bad answer buddy');
        speechOutput = requestAttributes.t('OUT_OF_RANGE_MSG', languageStrings.en.translation.CHOICES);
    } else {
        attributes.counter += 1;
        const isCorrect = isTheAnswerCorrect(attributes.correctAnswer, utteredAnswer);
        //console.log('##########>' + multiChoiceArray.toString() + '/' + multiChoiceArray[utteredAnswer -1] + '/' + utteredAnswer);
        
        cardInfoArray.push(attributes.counter + '. ' + util.capitalizeFirst(questionArray[attributes.counter -1]) + ' ' + 
        util.capitalizeAll(multiChoiceArray[utteredAnswer -1]) + ', (' + util.capitalizeAll(relAnswers[attributes.counter -1]) + ')');
        if (isCorrect) {
            speechOutput = getSpeechCon(handlerInput, true);
            attributes.quizScore += 1;
        } else {
            speechOutput = getSpeechCon(handlerInput, false);
        }

        if (attributes.counter < numQuestions) { // Number of keys in the circleKeys array
            question = askQuestion(handlerInput);
            speechOutput += question;
        } else {
            // last question has been asked
            speechOutput += marksOutOfTen(handlerInput); // well it might not actually be 10
            repromptOutput = repromptOutput = requestAttributes.t('ASK_PLAY_AGAIN');
            //console.log('speechOutput=' + speechOutput);
            attributes.skillState = states.END;
        }
    }

    //SAVE ATTRIBUTES
    handlerInput.attributesManager.setSessionAttributes(attributes);
    //console.log('Asking question ' + attributes.counter + ' =========================== ' + speechOutput);

    return speechOutput;
}

const RepeatIntentHandler = {
    canHandle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
                      
        return request.type === "IntentRequest" &&
            request.intent.name === "AMAZON.RepeatIntent";
    },
    handle(handlerInput) {
        //console.log('Handling repeat intent');
        const attributes = handlerInput.attributesManager.getSessionAttributes();
        const requestAttributes = handlerInput.attributesManager.getRequestAttributes();

        if (attributes.skillState === states.END) {
            speechOutput = requestAttributes.t('NEW_TEST_MESSAGE');
            repromptOutput = requestAttributes.t('NEW_TEST_MESSAGE');
        } else {
            speechOutput = lastQuestionAsked;
            repromptOutput = lastQuestionAsked;
        }
        return handlerInput.responseBuilder
            .speak(speechOutput)
            .reprompt(repromptOutput)
            .getResponse();
    },
};

const NoIntentHandler = {
    canHandle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
        return request.type === 'IntentRequest' &&
            request.intent.name === 'AMAZON.NoIntent';
            
    },
    handle(handlerInput) {
        const attributes = handlerInput.attributesManager.getSessionAttributes();
        const requestAttributes = handlerInput.attributesManager.getRequestAttributes();

        if (attributes.skillState === states.END) {
            return exitSkill(handlerInput);
        } else if (attributes.skillState === states.RESTART) {
            speechOutput = requestAttributes.t('RESTART_TEST_FALSE') + '. ' + lastQuestionAsked;
            repromptOutput = lastQuestionAsked;
            attributes.skillState = states.QUIZ;
            handlerInput.attributesManager.setSessionAttributes(attributes);
        } else if (attributes.skillState === states.QUIZ) {
            speechOutput = lastQuestionAsked;
            repromptOutput = lastQuestionAsked;
        } else {
            speechOutput = requestAttributes.t('HELP_MESSAGE_SHORT');
            repromptOutput = requestAttributes.t('HELP_MESSAGE_SHORT');
        }

        return handlerInput.responseBuilder
            .speak(speechOutput)
            .reprompt(repromptOutput)
            .getResponse();
    },
};

const YesIntentHandler = {
    canHandle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
        return request.type === 'IntentRequest' &&
            request.intent.name === 'AMAZON.YesIntent';
    },
    handle(handlerInput) {
        const response = handlerInput.responseBuilder;
        const attributes = handlerInput.attributesManager.getSessionAttributes();
        const requestAttributes = handlerInput.attributesManager.getRequestAttributes();

        var speechOutput = '';

        //console.log('attributes.skillState=' + attributes.skillState);
        if (attributes.skillState === states.END || attributes.skillState === states.RESTART) {
            // User want's a new test or to abandon current test
            speechOutput = requestAttributes.t('PICK_A_TEST_MSG');
            repromptOutput = requestAttributes.t('PICK_A_TEST_MSG');
        } else if (attributes.skillState === states.QUIZ) {
            speechOutput = lastQuestionAsked;
            repromptOutput = lastQuestionAsked;
        } else {
            speechOutput = requestAttributes.t('HELP_MESSAGE_SHORT');
            repromptOutput = requestAttributes.t('HELP_MESSAGE_SHORT');
        }
        return response
            .speak(speechOutput)
            .reprompt(repromptOutput)
            .getResponse();
    },
};

const StartOverHandler = { // don't allow restart if game has ended. See RepeatIntentHandler.
    canHandle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;

        return request.type === "IntentRequest" &&
            request.intent.name === "AMAZON.StartOverIntent";
    },
    handle(handlerInput) {
        //console.log('NEW GAME REQUESTED');
        const attributes = handlerInput.attributesManager.getSessionAttributes();
        const requestAttributes = handlerInput.attributesManager.getRequestAttributes();

        if (attributes.skillState === states.END) {
            speechOutput = requestAttributes.t('NEW_TEST_MESSAGE');
            repromptOutput = requestAttributes.t('NEW_TEST_MESSAGE');
        } else {
            speechOutput = requestAttributes.t('CONFIRM_RESTART_TEST');
            repromptOutput = requestAttributes.t('YES_OR_NO');
            attributes.skillState = states.RESTART;
            handlerInput.attributesManager.setSessionAttributes(attributes);
        }
        
        return handlerInput.responseBuilder
            .speak(speechOutput)
            .reprompt(repromptOutput)
            .getResponse();
    },
};

function exitSkill(handlerInput) {
    const response = handlerInput.responseBuilder;
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    const attributes = handlerInput.attributesManager.getSessionAttributes();

    response.withShouldEndSession(true);
    if (attributes.skillState === states.QUIZ) {
        //Show the app card if the skill is ended in the middle of a game
        response.withSimpleCard(requestAttributes.t('SKILL_NAME'), printCardInfo(handlerInput));
        if (supportsDisplay(handlerInput)) {
            //response.withSimpleCard(requestAttributes.t('SKILL_NAME'), printCardInfo(handlerInput));
            return bodyTemplateMaker('BodyTemplate2', handlerInput, asset.ASSET_IMG.mainImage, null, requestAttributes.t('EXIT_SKILL_MESSAGE'), null, null, 
                requestAttributes.t('EXIT_SKILL_MESSAGE'), null, null, asset.ASSET_IMG.mainImgBlurBG, true);
        } else {
        //    console.log('exitSkill and does not support Display');
            //response.withSimpleCard(requestAttributes.t('SKILL_NAME'), printCardInfo(handlerInput));
            return response
                .speak(requestAttributes.t('EXIT_SKILL_MESSAGE'))
                .getResponse();    
        }
    } else {
        return response
                .speak(requestAttributes.t('EXIT_SKILL_MESSAGE'))
                .getResponse();
    }

    
}

function askQuestion(handlerInput) {
    //console.log('I am in askQuestion()');

    //GET SESSION ATTRIBUTES
    const attributes = handlerInput.attributesManager.getSessionAttributes();
    const question = getQuestion(attributes.counter +1, questionArray[attributes.counter]);
    var correctAnswer = relAnswers[attributes.counter];

    //Remove the key that is the subject of the question so that it doesn't appear in the multi choice list
    //console.log('fifteenKeys before remove is ' + fifteenKeys);
    var shuffledKeyArray = util.reduceArray(fifteenKeys, keyQuestionArray[attributes.counter]);
    //console.log('fifteenKeys after remove is ' + shuffledKeyArray);
    shuffledKeyArray = util.shuffleArray(shuffledKeyArray);

    var correctAnswerIndex = shuffledKeyArray.indexOf(correctAnswer);

    shuffledKeyArray.splice(correctAnswerIndex, 1);

    //console.log('shuffledKeyArray=' + shuffledKeyArray);
    // Create a new array containing the first two elements of the shuffled key array
    var newArray = shuffledKeyArray.slice(0, 2);
    //console.log('newArray before pushing correctAnswer=' + newArray);
    newArray.push(correctAnswer);
    //console.log('newArray after pushing correctAnswer=' + newArray);

    multiChoiceArray = util.shuffleArray(newArray);
    //console.log('multiChoiceArray=' + multiChoiceArray);
    var correctAnswerIndex = multiChoiceArray.indexOf(correctAnswer);
    attributes.correctAnswer = correctAnswerIndex + 1;

    // The splice method took the correct answer out of the array so put it back
    shuffledKeyArray.push(correctAnswer);
    var multiChoiceString = formatMultiChoiceString(multiChoiceArray);

    //SAVE ATTRIBUTES
    handlerInput.attributesManager.setSessionAttributes(attributes);
    //console.log('question to save is ' + question);
    //console.log('multiChoiceString is "' + multiChoiceString + '"');
    lastQuestionAsked = question + ' ' + multiChoiceString

    var itemList = [];
    for (i = 0, len = multiChoiceArray.length; i < len; i++) {
        itemList.push(
            {
                "token": i+1,
                "textContent": new Alexa.RichTextContentHelper()
                .withPrimaryText(util.capitalizeAll(multiChoiceArray[i])).getTextContent(),
                //Can't change font color through tags so the below could be used to make the text color blue
                //.withPrimaryText('<action value="confirm_purchase">' + util.capitalizeAll(multiChoiceArray[i]) + '</action>').getTextContent(),
            }
        );
    }
    
    var capQuestion = util.capitalizeFirst(questionArray[attributes.counter]);

    // Set up the list displaying the multi choice answers for devices with screens
    if (supportsDisplay(handlerInput)) {
        const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
        const title = requestAttributes.t('HASDISPLAY_TITLE', attributes.counter +1, numQuestions, capQuestion);
        handlerInput.responseBuilder.addRenderTemplateDirective({
            type: 'ListTemplate1',
            token: 'string',
            backButton: 'hidden',
            title,
            listItems: itemList,
        });
    }
    return lastQuestionAsked;
}

async function setupQuiz(handlerInput, quiz) {
    //console.log('setupQuiz for ' + quiz);

    // get the 12 keys which will include three random enharmonics
    circleKeys = util.makeACircle(circleKeys_);
    var dataRandomized = []; // an array to hold a randomized version of the above circleKeys array

    fifteenKeys = [];
    for (j = 0, len_ = circleKeys.length; j < len_; j++) {
        fifteenKeys.push(circleKeys[j][0]); 
    }

    resetAttributes(handlerInput);

    // Get or set the number of questions per test
    const dbattributes = await handlerInput.attributesManager.getPersistentAttributes(); // <--dynamodb
    if (typeof dbattributes.questionsPerTest === 'undefined') {
        dbattributes.questionsPerTest = 6; // Set to this value if no record exists
        handlerInput.attributesManager.setPersistentAttributes(dbattributes);
        await handlerInput.attributesManager.savePersistentAttributes();
    }
    numQuestions = dbattributes.questionsPerTest;
    //const dbattributes = await handlerInput.attributesManager.getPersistentAttributes(); // <--dynamodb
    //numQuestions = dbattributes.questionsPerTest;

    // we get the translator 't' function from the request attributes
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    const attributes = handlerInput.attributesManager.getSessionAttributes();
    const response = handlerInput.responseBuilder;

    // randomly set the quiz to be 4ths or 5ths if the user asks Alexa to choose
    // How would this work with non En languages?
    var textPrefix = '';
    switch (quiz) {
        case 'either':
        case 'choose':
        case 'pick':
        case 'start':
            quiz = Math.floor((Math.random() * 2)) == 0 ? 'fourths' : 'fifths';
            textPrefix = requestAttributes.t('RANDOM_TEST') + quiz + '. ';
            break;
        case 'mix':
        case 'mixed':
        case 'mixture':
            quiz = 'mixed';
            break;
        default:
            // must be 4ths or 5ths so leave it alone
            //quiz = quiz;
            break;
    }
    //console.log('quiz now=' + quiz);

    questionArray = [];
    cardInfoArray = [];
    relAnswers = [];
    dataRandomized = util.shuffleArray(circleKeys);
    //console.log('dataRandomized is ' + dataRandomized);

    // Loop through the list of keys (12 or 15?) and generate a question & answer for each one.
    for (i = 0, len = numQuestions; i < len; i++) {
        var KEY = dataRandomized[i][0];
        //console.log('KEY=' + KEY);
        if (quiz.startsWith('4') || quiz.startsWith('four')) { // user said fourths
            //console.log('setting up for fourths');
            var relQuestions4ths = requestAttributes.t('RELQUESTIONS_4ths');
            var Q = relQuestions4ths.charAt(0); // first character is digit 0 or 1
            var QUESTION = relQuestions4ths.replace("X", util.capitalizeAll(KEY)).substr(2); // replace X with the key and get rid of the first 2 chars
            ANSWER = Q == 0 ? dataRandomized[i][1] : dataRandomized[i][2]; // element 1 is the 4th. Element 2 is the 5th.
        } else if (quiz.startsWith('5') || quiz.startsWith('fifth')) { // user said fifths
            //console.log('setting up for fifths');
            var relQuestions5ths = requestAttributes.t('RELQUESTIONS_5ths');
            var Q = relQuestions5ths.charAt(0); // first character is digit 2 or 3
            var QUESTION = relQuestions5ths.replace("X", util.capitalizeAll(KEY)).substr(2); // replace X with the key and get rid of the first 2 chars
            ANSWER = Q == 2 ? dataRandomized[i][2] : dataRandomized[i][1]; // element 1 is the 4th. Element 2 is the 5th.
        } else { // anything else must be random
            // Get a random 4ths or 5ths question
            var relQuestionsMix = Math.floor((Math.random() * 2)) == 0 ? requestAttributes.t('RELQUESTIONS_4ths') : requestAttributes.t('RELQUESTIONS_5ths');
            var Q = relQuestionsMix.charAt(0); // first character is digit 0-3
            var QUESTION = relQuestionsMix.replace("X", util.capitalizeAll(KEY)).substr(2); // replace X with the key and get rid of the first 2 chars
            ANSWER = (Q == 0 || Q == 3) ? dataRandomized[i][1] : dataRandomized[i][2];
        }
        questionArray.push(QUESTION);
        relAnswers.push(ANSWER);
        keyQuestionArray.push(KEY);
        //console.log('QUESTION=' + QUESTION);
        //console.log('ANSWER=' + ANSWER);
    }

    attributes.skillState = states.QUIZ;
    attributes.skillTest = quiz;
    attributes.counter = 0;
    attributes.quizScore = 0;
    handlerInput.attributesManager.setSessionAttributes(attributes);

    var question = askQuestion(handlerInput);

    speechOutput = textPrefix + requestAttributes.t('GREETING') + question; // Preface the question with a random greeting
    repromptOutput = question;

    response.withShouldEndSession(null);

    return response
            .speak(speechOutput)
            .reprompt(repromptOutput)
            .getResponse();
}

function getQuestion(counter, questionToAsk) {
    return `Question ${counter}. ${questionToAsk}`; // need to get this into en.js
    //return `Here is your ${counter}th question. ${questionToAsk}`;
}

function formatMultiChoiceString(rawData) {
    //console.log('rawData=' + rawData + '\nrawData.length=' + rawData.length);
    var S = '';
    for (i = 0, len = rawData.length; i < len; i++) {
        S += (i + 1).toString() + '. ' +
            '<say-as interpret-as="spell-out">' +
            rawData[i].substring(0, 1) + '</say-as>' +
            rawData[i].substring(1, rawData[i].length) + '. ';
    }
    return S;
}

function marksOutOfTen(handlerInput) {
    const attributes = handlerInput.attributesManager.getSessionAttributes();
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();

    const percentScore = attributes.quizScore / numQuestions * 100;
    var superlative = '';
    if (percentScore > 99) {
        superlative = requestAttributes.t('SUPERLATIVE_100');
    } else if (percentScore > 79) {
        superlative = requestAttributes.t('SUPERLATIVE_80PLUS');
    } else {
        superlative = requestAttributes.t('SUPERLATIVE_NOT_SO_GOOD');
    }

    // attributes.percentScore will get saved in the calling function
    attributes.percentScore = percentScore;

    return requestAttributes.t('END_GAME_MESSAGE_1', attributes.quizScore, numQuestions) + '. ' 
                    + superlative + requestAttributes.t('ASK_PLAY_AGAIN');
}

const ElementSelectedHandler = {
    canHandle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
        //return (request.type === 'IntentRequest' &&
        //    request.intent.name === 'ElementSelected')
        //    || request.type === 'Display.ElementSelected';
        return request.type === 'Display.ElementSelected';
    },
    handle(handlerInput) {
        //console.log('Handling ElementSelectedHandler');
        const attributes = handlerInput.attributesManager.getSessionAttributes();
        const response = handlerInput.responseBuilder;

        // not sure we can get here if the test was started by voice which would be good (less code required)
        if (handlerInput.requestEnvelope.request.token) {
            //User touched the screen
            //console.log('user touched ' + handlerInput.requestEnvelope.request.token);
            //console.log('attributes.skillState=' +attributes.skillState);
            if(attributes.skillState === undefined) {
                // token here should either be 'fourths', 'fifths' or 'random'
                return setupQuiz(handlerInput, handlerInput.requestEnvelope.request.token);
            } else {
                var optionSelected = handlerInput.requestEnvelope.request.token;
                speechOutput = HandleTheAnswer(handlerInput, optionSelected); // i.e. pass the element + 1
                //console.log('ElementSelectedHandler speechOutput=' + speechOutput);
                //console.log('ElementSelectedHandler=' + attributes.skillState + ',supportsDisplay=' + supportsDisplay(handlerInput));
                if (attributes.skillState === states.END) {
                    //console.log('ElementSelectedHandler End of game!')
                    return gameOverWithDisplay(handlerInput, speechOutput);
                } else {
                    return response
                        .speak(speechOutput)
                        .reprompt(speechOutput)
                        .getResponse();
                }
            }

        }

    },
};

function getSpeechCon(handlerInput, type) {
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    return type ? requestAttributes.t('CORRECT_ANSWER') : '<audio src=' + asset.ASSET_AUD.wrongAnswerAudio + '/>';
}

function isTheAnswerCorrect(correctAnswer, utteredAnswer) {
    //console.log('Correct answer is ' + correctAnswer + '. ' + 'Uttered answer is ' + utteredAnswer);
    return correctAnswer == utteredAnswer ? true : false;
}

const HelpHandler = {
    canHandle(handlerInput) {
        //console.log('Inside HelpHandler');
        const request = handlerInput.requestEnvelope.request;
        return request.type === 'IntentRequest' &&
            request.intent.name === 'AMAZON.HelpIntent';
    },
    handle(handlerInput) {
        //console.log('Inside HelpHandler - handle');
        const attributes = handlerInput.attributesManager.getSessionAttributes();
        const requestAttributes = handlerInput.attributesManager.getRequestAttributes();

        if (attributes.skillState === states.QUIZ) {
            // if the user asked for help in the middle of a quiz tag the last question on to the end of the contextual help text
            speechOutput = requestAttributes.t('MULTI_CHOICE_HELP_MSG') + lastQuestionAsked;
        } else if (attributes.skillState === states.END) {
            // if the user asked for help at the end of the game give them a short message
            speechOutput = requestAttributes.t('NEW_TEST_MESSAGE');
        } else {
            speechOutput = requestAttributes.t('HELP_MESSAGE_LONG');
        }
        return handlerInput.responseBuilder
            .speak(speechOutput)
            .reprompt(requestAttributes.t('HELP_MESSAGE_SHORT'))
            .getResponse();
    },
};


const HintHandler = {
    canHandle(handlerInput) {
        //console.log('Inside HintHandler');
        const request = handlerInput.requestEnvelope.request;
        return request.type === 'IntentRequest' &&
            request.intent.name === 'HintIntent';
    },
    handle(handlerInput) {
        //console.log('Inside HintHandler - handle');
        const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
        speechOutput = requestAttributes.t('COF_EXPLANATION');
        return handlerInput.responseBuilder
            .speak(speechOutput)
            .reprompt(requestAttributes.t('HELP_MESSAGE_SHORT'))
            .getResponse();
    },
};


const ExitHandler = {
    canHandle(handlerInput) {
        //console.log('Inside ExitHandler');
        const request = handlerInput.requestEnvelope.request;

        return request.type === 'IntentRequest' && (
            request.intent.name === 'AMAZON.StopIntent' ||
            request.intent.name === 'AMAZON.PauseIntent' ||
            request.intent.name === 'AMAZON.CancelIntent'
        );
    },
    handle(handlerInput) {
        return exitSkill(handlerInput);
    },
};

const SessionEndedRequestHandler = {
    canHandle(handlerInput) {
        //console.log('Inside SessionEndedRequestHandler');
        return handlerInput.requestEnvelope.request.type === 'SessionEndedRequest';
    },
    handle(handlerInput) {
        console.log(`Session ended with reason: ${JSON.stringify(handlerInput.requestEnvelope)}`);
        return handlerInput.responseBuilder.getResponse();
    },
};

const ErrorHandler = {
    canHandle() {
        //console.log("Inside ErrorHandler");
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
        return request.type === 'IntentRequest'
            && request.intent.name === 'AMAZON.FallbackIntent';
    },
    handle(handlerInput) {
        //console.log('Handling FallbackHandler');
        const attributes = handlerInput.attributesManager.getSessionAttributes();
        //console.log('FallbackHandler attributes.skillState=' + attributes.skillState);
        const requestAttributes = handlerInput.attributesManager.getRequestAttributes();

        speechOutput = requestAttributes.t('FALLBACK_MESSAGE');

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
            speechOutput += requestAttributes.t('OUT_OF_RANGE_MSG', languageStrings.en.translation.CHOICES);
            repromptOutput = lastQuestionAsked;
        }
        return handlerInput.responseBuilder
            .speak(speechOutput)
            .reprompt(repromptOutput)
            .getResponse();
    },
  };

  const SetupHandler = {
    // currently only available for GB language
    canHandle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
        //console.log('Inside SetupHandler');
        return request.type === 'IntentRequest'
            && request.intent.name === 'SetupIntent';
    },
    handle(handlerInput) {
        //console.log('Handling SetupHandler');
        // Allow the number of questions to be changed
        const attributes = handlerInput.attributesManager.getSessionAttributes();
        attributes.skillState = states.SETUP;
        handlerInput.attributesManager.setSessionAttributes(attributes);

        speechOutput = 'how many questions?';
        repromptOutput = 'how many questions?';

        return handlerInput.responseBuilder
            .speak(speechOutput)
            .reprompt(repromptOutput)
            .getResponse();
    },
  };


/* HELPER FUNCTIONS */

// returns true if the skill is running on a device with a display (show|spot)
function supportsDisplay(handlerInput) {
    var hasDisplay =
        handlerInput.requestEnvelope.context &&
        handlerInput.requestEnvelope.context.System &&
        handlerInput.requestEnvelope.context.System.device &&
        handlerInput.requestEnvelope.context.System.device.supportedInterfaces &&
        handlerInput.requestEnvelope.context.System.device.supportedInterfaces.Display
    return hasDisplay;
}

function showSkillIntro(pSpeechOutput, pReprompt, handlerInput) {
    //console.log('In showSkillIntro');

    var speechOutput = pSpeechOutput;
    var reprompt = pReprompt

    if (supportsDisplay(handlerInput)) {
        const requestAttributes = handlerInput.attributesManager.getRequestAttributes();

        //Selectable text
        // below three lines will not work for non english language
        var actionText1 = '<action value="fourths"><b>' + languageStrings.en.translation['VALID_TEST'][0] + '</b></action>';
        var actionText2 = '<action value="fifths"><b>' + languageStrings.en.translation['VALID_TEST'][1] + '</b></action>';
        var actionText3 = '<action value="mixed"><b>' + languageStrings.en.translation['VALID_TEST'][2] + '</b></action>';

        var text = '<font size="5">'  + requestAttributes.t('SKILL_NAME') + '</font><br/>' + requestAttributes.t('DISPLAYINTRO1') +
                    actionText1 + ' or ' + actionText2 + '.<br/>' + requestAttributes.t('LIT1') + 
                    actionText3 + requestAttributes.t('DISPLAYINTRO2');
                    
        return bodyTemplateMaker('BodyTemplate2', handlerInput, asset.ASSET_IMG.mainImage, null, text, null, null, 
                speechOutput, reprompt, requestAttributes.t('HINT_1'), asset.ASSET_IMG.mainImgBlurBG, false);
    } else {
        const response = handlerInput.responseBuilder;

        return response
            .speak(speechOutput)
            .reprompt(reprompt)
            .getResponse();
    }
}

function resetAttributes(handlerInput) {

    const attributes = handlerInput.attributesManager.getSessionAttributes();

    attributes.skillState = null;
    attributes.skillTest = null;
    attributes.counter = 0;
    attributes.quizScore = 0;
    attributes.percentScore = 0;
    
    handlerInput.attributesManager.setSessionAttributes(attributes);
}

function bodyTemplateMaker(pBodyTemplateType, handlerInput, pImg, pTitle, pText1, pText2, pText3, pOutputSpeech, pReprompt, pHint, pBackgroundIMG, pEndSession) {
    const attributes = handlerInput.attributesManager.getSessionAttributes();
    const response = handlerInput.responseBuilder;
    const image = imageMaker("", pImg);
    const richText = richTextMaker(pText1, pText2, pText3);
    const backgroundImage = imageMaker("", pBackgroundIMG);
    const title = pTitle;

    response.addRenderTemplateDirective({
        type: pBodyTemplateType,
        backButton: 'HIDDEN',
        image,
        backgroundImage,
        title,
        textContent: richText,
    });

    if (pHint)
        response.addHintDirective(pHint);

    if (pOutputSpeech)
        response.speak(pOutputSpeech);

    if (pReprompt)
        response.reprompt(pReprompt)

    if (pEndSession)
        response.withShouldEndSession(pEndSession);

    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();

    // If game has finished show the card in the app. #needs attention as if the game ends prematurely we won't get here
    //console.log('bodyTemplateMaker attributes.skillState=' + attributes.skillState);
    if (attributes.skillState === states.END) // Not working for touch response. Maybe an Alexa bug as the card info shows in the reponse json
        response.withSimpleCard(requestAttributes.t('SKILL_NAME') + requestAttributes.t('SUMMARY_TXT'), printCardInfo(handlerInput));

    return response.getResponse();
}

function imageMaker(pDesc, pSource) {
    const myImage = new Alexa.ImageHelper()
        .withDescription(pDesc)
        .addImageInstance(pSource)
        .getImage();

    return myImage;
}

function richTextMaker(pPrimaryText, pSecondaryText, pTertiaryText) {
    const myTextContent = new Alexa.RichTextContentHelper();

    if (pPrimaryText)
        myTextContent.withPrimaryText(pPrimaryText);

    if (pSecondaryText)
        myTextContent.withSecondaryText(pSecondaryText);

    if (pTertiaryText)
        myTextContent.withTertiaryText(pTertiaryText);

    return myTextContent.getTextContent();
}

function gameOverWithDisplay(handlerInput, speechOutput) {
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    const attributes = handlerInput.attributesManager.getSessionAttributes();

    // if the user gets 100% display the tropy otherwise just an end game message
    if (attributes.percentScore == 100) {
        // move literals to en.js
        return bodyTemplateMaker('BodyTemplate2', handlerInput, asset.ASSET_IMG.trophyImage, 'End of ' + attributes.skillTest + ' test',
        "<div align='center'><font size='5'>" + requestAttributes.t('END_GAME_MESSAGE_1', attributes.quizScore, numQuestions) + "</font></div>",
        "<div align='center'><font size='4'>" + requestAttributes.t('TESTS_AVAILABLE') + "</font></div>",
        null, speechOutput, repromptOutput, null, asset.ASSET_IMG.gameEndImage100, false);
    } else {
        return bodyTemplateMaker('BodyTemplate2', handlerInput, asset.ASSET_IMG.mainImage, 'End of ' + attributes.skillTest + ' test',
        "<div align='center'><font size='5'>" + requestAttributes.t('END_GAME_MESSAGE_1', attributes.quizScore, numQuestions) + "</font></div>",
        "<div align='center'><font size='4'>" + requestAttributes.t('TESTS_AVAILABLE') + "</font></div>",
        null, speechOutput, repromptOutput, null, asset.ASSET_IMG.gameEndImageNot100, false);
    }
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

var skillBuilder = Alexa.SkillBuilders.custom();
//const skillBuilder = Alexa.SkillBuilders.standard();
/* LAMBDA SETUP */
exports.handler = skillBuilder
    .addRequestHandlers(
        LaunchRequestHandler,
        RepeatIntentHandler,
        StartOverHandler,
        QuizHandler,
        QuizAnswerHandler,
        SetNumberOfQuestionsHandler,
        ElementSelectedHandler,
        HelpHandler,
        HintHandler,
        ExitHandler,
        FallbackHandler,
        NoIntentHandler,
        YesIntentHandler,
        SetupHandler,
        SessionEndedRequestHandler
    )
    .addRequestInterceptors(LocalizationInterceptor) 
    .withPersistenceAdapter(persistenceAdapter) // <-- dynamodb
    .addErrorHandlers(ErrorHandler)
    .lambda();
