import { APIGatewayProxyHandler } from 'aws-lambda';
import { S3 } from 'aws-sdk';
import { document } from '../utils/dynamodbClient';
import { readFileSync } from 'fs';
import { compile } from 'handlebars';
import { join } from 'path';    
import chromium from 'chrome-aws-lambda';
import dayjs from 'dayjs';

interface ICreateCertificate {
    id: string;
    name: string;
    grade: string;
};

interface ITemplate {
    id: string;
    name: string;
    grade: string;
    medal: string;
    date: string;
};

const compileTemplate = async (data: ITemplate) => {
    const filePath = join(process.cwd(), "src", "templates", "certificate.hbs");

    const html = readFileSync(filePath, "utf8");

    return compile(html)(data)
};

export const handler: APIGatewayProxyHandler = async (event) => {
    const { id, name, grade } = JSON.parse(event.body) as ICreateCertificate;

    const response = await document.query({
        TableName: 'users_certificate',
        KeyConditionExpression: 'id = :id',
        ExpressionAttributeValues: {
            ':id': id
        }
    }).promise();

    const userAlreadyExists = response.Items[0];

    if(!userAlreadyExists) {
        await document.put({
            TableName: 'users_certificate',
            Item: {
                id,
                name,
                grade,
                created_at: new Date().getTime(),
            }
        }).promise();
    };

    const medalPath = join(process.cwd(), "src", "templates", "selo.png");
    const medal = readFileSync(medalPath, "base64")

    const data: ITemplate = {
        id,
        name,
        grade,
        medal,
        date: dayjs().format("DD/MM/YYYY"),
    }

    const content = await compileTemplate(data);

    const browser = await chromium.puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath,
        userDataDir: 'tmp',
    });

    const page = await browser.newPage();

    await page.setContent(content);

    const isOffline = () => {
        return process.env.IS_OFFLINE
    };

    const pdf = await page.pdf({
        format: "a4",
        landscape: true,
        printBackground: true,
        preferCSSPageSize: true,
        path: isOffline() ? "./tmp/certificate.pdf" : null,
    });

    await browser.close();

    const s3 = new S3();

    await s3.putObject({
        Bucket: "certificate-nodejs-rocketseat-2021",
        Key: `${id}.pdf`,
        ACL: "public-read",
        Body: pdf,
        ContentType: "application/pdf",
    }).promise();

    return {
        statusCode:201,
        body: JSON.stringify({
            message: "Certificado criado com sucesso!",
            url: `https://certificate-nodejs-rocketseat-2021.s3.sa-east-1.amazonaws.com/${id}.pdf`
        })
    }
}