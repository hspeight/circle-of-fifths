
const aws = require('aws-sdk');
const s3 = new aws.S3();


function getLevelDataFromS3 () {

    const params = {
        Bucket: 'cof-drills',
        Key: 's3csv.cs',
        ExpressionType: 'SQL',
        Expression: 'SELECT user_name FROM S3Object WHERE name="hector',
        InputSerialization: {
            CSV: {
                FileHeaderInfo: 'USE',
                RecordDelimiter: '\n',
                FieldDelimiter: ','
            }
        },
        OutputSerialization: {
            CSV: {}
        }
    };

    return params['Payload'];
}



const data = getLevelDataFromS3();
console.log(data);
